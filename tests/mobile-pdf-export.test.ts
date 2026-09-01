import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Exporting a site log as a PDF, on a device with no downloads folder.
 *
 * This was recorded in the plan for days as blocked on `expo-sharing`, and so
 * on a new development build. It was not: the render op hands back base64, and
 * storage plus the browser turns that into something a person can see, keep and
 * send using modules the app already ships. The wrong assumption was mine, and
 * it is worth a test because the obvious "fix" for a future reader is to reach
 * for the native module again.
 *
 * What is pinned here is the set of decisions whose failure is SILENT: filing
 * the file so it survives, cleaning up an orphan if the row insert fails,
 * sending the idempotency key the op is registered to need, and invalidating a
 * query key that actually exists.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const api = () => read("apps/mobile/src/api/site-logs.ts");
const filing = () => read("apps/mobile/src/api/pdf-export.ts");
const pages = () => read("apps/mobile/src/api/pages.ts");

/*
 * Just the export function, not the whole module.
 *
 * The first draft of the idempotency assertion below searched the file and
 * passed with the key deleted from the export, because `describeSiteLogPhotos`
 * a few lines above sends an identical one. A guard that cannot fail is worse
 * than no guard: it reads as coverage.
 */
const exportFn = () => {
  const s = api();
  const start = s.indexOf("export async function exportSiteLogPdf");
  expect(start, "exportSiteLogPdf has been renamed or removed").toBeGreaterThan(-1);
  const next = s.indexOf("export async function ", start + 1);
  return s.slice(start, next === -1 ? undefined : next);
};
const screen = () => read("apps/mobile/app/(app)/site-log/[logId].tsx");

describe("the export needs no native module", () => {
  it("adds no new native dependency", () => {
    /*
     * The point of the whole approach. A native module means a new development
     * build, which invalidates whatever the testing session is holding.
     */
    const pkg = JSON.parse(read("apps/mobile/package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps["expo-sharing"]).toBeUndefined();
    expect(deps["expo-print"]).toBeUndefined();
  });

  it("uses the file-system and browser modules already shipped", () => {
    const pkg = JSON.parse(read("apps/mobile/package.json"));
    expect(pkg.dependencies["expo-file-system"]).toBeTruthy();
    expect(pkg.dependencies["expo-web-browser"]).toBeTruthy();
    expect(screen()).toContain("WebBrowser.openBrowserAsync(result.url)");
  });
});

describe("the file is filed, not dropped in a cache", () => {
  it("uploads to the documents bucket the rest of the app uses", () => {
    /*
     * Not `site-photos`. A PDF in the photo bucket is invisible to every
     * document path in both clients, and the photo grid would be reading rows
     * that point at a file it cannot render.
     */
    const s = filing();
    expect(s).toContain('.from("site-documents")');
    expect(s).toContain('contentType: "application/pdf"');
  });

  it("writes the row that makes it findable", () => {
    const s = filing().replace(/\s+/g, " ");
    expect(s).toContain('from("project_documents").insert(');
    expect(s).toContain('mime_type: "application/pdf"');
  });

  it("keys the object under the user, which is what RLS reads", () => {
    // Same shape as the web uploader. A path that did not start with the user
    // id would upload fine and be unreadable afterwards.
    expect(filing()).toContain("`${userId}/${args.projectId}/${randomUUID()}-${safeName}`");
  });

  it("reclaims the object when the row insert fails", () => {
    /*
     * The orphan. Every delete path in the app keys off `storage_path`, so an
     * uploaded file with no row pointing at it can never be removed by anyone,
     * and it still counts against storage.
     */
    const s = filing().replace(/\s+/g, " ");
    expect(s).toContain('.from("site-documents").remove([path])');
  });

  it("deletes the scratch file whichever way the upload goes", () => {
    // In a `finally`. On the error path the cache copy is the one thing that
    // definitely got written, and leaving it grows without bound.
    const s = filing().replace(/\s+/g, " ");
    expect(s).toContain("} finally { try { scratch.delete(); }");
  });
});

describe("the two silent failures", () => {
  it("sends an idempotency key, without which the op is not idempotent", () => {
    /*
     * `generateSiteLogPdf` is registered idempotent, and the web caller marks
     * it so. Server-side `beginIdempotency` returns `{ kind: "skip" }` when no
     * header arrives, so omitting the key does not error - it quietly bills a
     * second render for a double tap.
     */
    const s = exportFn().replace(/\s+/g, " ");
    expect(s).toContain('"generateSiteLogPdf"');
    expect(s).toContain("idempotencyKey: randomUUID(), timeoutMs: AI_TIMEOUT_MS");
  });

  it("invalidates the key the documents screen actually uses", () => {
    /*
     * The bug this caught while being written. The first draft invalidated
     * `["project-documents"]`; the Documents tab is keyed `["document-tree",
     * projectId]`. Invalidating a key nothing subscribes to throws no error and
     * refetches nothing, so the export looks like it filed nothing.
     */
    const docs = read("apps/mobile/app/(app)/project/[id]/documents.tsx");
    expect(docs).toContain('["document-tree", id]');
    expect(screen()).toContain('queryKey: ["document-tree", project]');
  });

  it("exports what is on screen, not what the server last saw", () => {
    /*
     * Notes commit on blur. Building the items from the query cache would drop
     * the sentence still under the cursor - a PDF that is quietly incomplete,
     * which nobody reports and everybody stops trusting.
     */
    const s = screen().replace(/\s+/g, " ");
    expect(s).toContain("const note = noteFor(notes, photoId);");
    expect(s).not.toContain("noteFor(query.data.notes");
  });
});

describe("the long render", () => {
  it("does not use the 30s default", () => {
    /*
     * The server embeds every photo on the log before it answers, and its own
     * comment calls a PDF render the slowest request it serves. At the default
     * timeout a big log aborts on the client while the server is still working,
     * which bills the render and shows a failure.
     */
    expect(exportFn()).toContain("AI_TIMEOUT_MS");
    expect(read("packages/api-client/src/index.ts")).toContain("AI_TIMEOUT_MS = 120_000");
  });

  it("refuses an empty render rather than filing a blank file", () => {
    expect(api()).toContain("The PDF came back empty");
  });
});

/*
 * The document exporter, which is the same machinery pointed at a different op.
 *
 * It is worth its own block because the reason it exists is not "the web has
 * it": a signed-off method statement or a handover certificate is something
 * somebody has to hand over standing on site, and until this the answer was
 * "open a laptop".
 */
describe("documents export the same way", () => {
  const exportFn = () => {
    const s = pages();
    const start = s.indexOf("export async function exportPagePdf");
    expect(start, "exportPagePdf has been renamed or removed").toBeGreaterThan(-1);
    return s.slice(start);
  };

  it("shares one filing implementation with the site log export", () => {
    /*
     * Not a second copy. Two answers to "where does a PDF go on a phone" drift,
     * and the half that drifts is the orphan cleanup, which nobody notices
     * because its failure is invisible.
     */
    expect(exportFn()).toContain("fileGeneratedPdf(");
    expect(api()).toContain("fileGeneratedPdf(");
    expect(filing()).toContain("export async function fileGeneratedPdf");
  });

  it("sends the key and the long timeout", () => {
    const s = exportFn().replace(/\s+/g, " ");
    expect(s).toContain('"generatePagePdf"');
    expect(s).toContain("idempotencyKey: randomUUID(), timeoutMs: AI_TIMEOUT_MS");
  });

  it("is offered on read-only pages, which is the point", () => {
    /*
     * A page built from a rich template cannot be restructured on the phone.
     * Hiding the export behind the editable branch would mean the documents
     * most likely to need handing over are the ones that cannot be.
     */
    const screen = read("apps/mobile/app/(app)/page/[pageId].tsx");
    const exportAt = screen.indexOf('<SectionHeader title="Export" />');
    const readOnlyAt = screen.indexOf('<SectionHeader title="This page is read-only here" />');
    expect(exportAt).toBeGreaterThan(-1);
    expect(readOnlyAt).toBeGreaterThan(-1);
    // Outside the editable/read-only ternary entirely, like the share block.
    expect(exportAt).toBeGreaterThan(readOnlyAt);
  });

  it("refreshes the documents tree it just wrote into", () => {
    expect(read("apps/mobile/app/(app)/page/[pageId].tsx")).toContain(
      'queryKey: ["document-tree", project]',
    );
  });
});
