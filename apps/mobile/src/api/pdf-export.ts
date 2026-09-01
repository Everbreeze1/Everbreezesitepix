import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { supabase } from "@/lib/supabase";

/**
 * What to do with a PDF the server just rendered, on a device with no
 * downloads folder.
 *
 * The web answer is a blob and a download: the browser drops the file somewhere
 * the person knows about, and the job is done. A phone has no such place. A
 * file written to the app's cache is invisible to every other app, cannot be
 * sent to anyone, and is reclaimed the next time the OS wants the space, so
 * "exporting" into it produces a document that technically exists and
 * practically does not.
 *
 * So an export is FILED. It goes to `site-documents`, gets a
 * `project_documents` row, and turns up in the project's Documents tab like any
 * other file: findable tomorrow, visible on the web, and removable through the
 * delete paths that already exist. The signed URL is only the fast way to look
 * at it now.
 *
 * This is also why the app needs no `expo-sharing` and no new development
 * build. Storage plus the system browser gets view, keep and share out of
 * modules already shipped. The plan recorded a native module as a hard
 * requirement here for several days; it was an assumption written down once and
 * then read back as a fact.
 */

/** How long the returned link stays good. Long enough to read and send. */
const SIGNED_URL_SECONDS = 3600;

export async function fileGeneratedPdf(args: {
  projectId: string;
  pdfBase64: string;
  filename: string;
}): Promise<{ url: string; filename: string; storagePath: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error("You are signed out");

  /*
   * Base64 to bytes by way of a file, which is the same trick the annotator
   * uses. `Buffer` is a Node global Hermes does not have, and reaching for it
   * type-checks cleanly because `@types/node` is in the tree: it would have
   * failed on the device and nowhere before it.
   */
  const scratch = new File(Paths.cache, `export-${randomUUID()}.pdf`);
  scratch.create({ overwrite: true });
  scratch.write(args.pdfBase64, { encoding: "base64" });

  try {
    const bytes = await scratch.arrayBuffer();
    const safeName = args.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    // Same path shape as the web uploader. RLS reads the leading user id, so a
    // path that did not start with it would upload and then be unreadable.
    const path = `${userId}/${args.projectId}/${randomUUID()}-${safeName}`;

    const { error: upErr } = await supabase.storage
      .from("site-documents")
      .upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { error: insErr } = await (supabase as any).from("project_documents").insert({
      project_id: args.projectId,
      uploaded_by: userId,
      storage_path: path,
      file_name: args.filename,
      mime_type: "application/pdf",
      size_bytes: bytes.byteLength,
      folder_id: null,
    });
    if (insErr) {
      /*
       * Reclaim the upload. With no row pointing at it the object is unreachable
       * by every delete path in either client, all of which key off
       * `storage_path`, and it still counts against storage forever.
       */
      void supabase.storage.from("site-documents").remove([path]);
      throw new Error(insErr.message);
    }

    const { data: signed } = await supabase.storage
      .from("site-documents")
      .createSignedUrl(path, SIGNED_URL_SECONDS);
    if (!signed?.signedUrl) throw new Error("The file was saved but could not be opened");

    return { url: signed.signedUrl, filename: args.filename, storagePath: path };
  } finally {
    try {
      scratch.delete();
    } catch {
      // Cache directory; the OS reclaims it.
    }
  }
}
