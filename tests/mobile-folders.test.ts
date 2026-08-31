import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteFolderWarning,
  folderNameError,
  groupByFolder,
  groupCount,
  groupSummary,
  MAX_FOLDER_NAME,
  moveTargets,
} from "../apps/mobile/src/api/folders-view";
import type { DocumentFile, DocumentFolder, DocumentPage } from "../apps/mobile/src/api/pages";

/*
 * Filing documents into folders.
 *
 * The last of the named parity gaps, and the smallest: nothing was hidden
 * without it, because the tree returns every page and file whatever folder it
 * sits in. Reorganising, not access.
 *
 * The grouping is what earns a test. A naive `groupBy` drops any document whose
 * folder is not in the list, and on this screen the row is the only way anybody
 * could ever file it again.
 */

const folder = (over: Partial<DocumentFolder>): DocumentFolder => ({
  id: "f1",
  name: "Certificates",
  createdAt: "2026-08-01T09:00:00Z",
  ...over,
});

const page = (over: Partial<DocumentPage>): DocumentPage => ({
  id: "p1",
  kind: "page",
  folderId: null,
  title: "Site log",
  updatedAt: "2026-08-31T09:00:00Z",
  sourceTemplateId: null,
  bucket: "document",
  ...over,
});

const file = (over: Partial<DocumentFile>): DocumentFile => ({
  id: "d1",
  kind: "file",
  folderId: null,
  fileName: "cert.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024,
  createdAt: "2026-08-31T09:00:00Z",
  ...over,
});

describe("groupByFolder", () => {
  it("puts each document under its folder", () => {
    const groups = groupByFolder(
      [folder({ id: "f1", name: "Certificates" })],
      [page({ id: "p1", folderId: "f1" })],
      [file({ id: "d1", folderId: "f1" })],
    );
    const certs = groups.find((g) => g.id === "f1")!;
    expect(certs.pages.map((p) => p.id)).toEqual(["p1"]);
    expect(certs.files.map((f) => f.id)).toEqual(["d1"]);
  });

  it("keeps an orphan visible instead of losing it", () => {
    /*
     * The bug this exists to prevent. A document whose folder was deleted a
     * moment ago - on the web, or by somebody else - names a folder that is not
     * in the tree. Dropping it would take the only row from which anybody could
     * file it again.
     */
    const groups = groupByFolder([], [page({ id: "orphan", folderId: "gone" })], []);
    const top = groups.find((g) => g.id === null)!;
    expect(top.pages.map((p) => p.id)).toEqual(["orphan"]);
  });

  it("always has a top level, even when it is empty", () => {
    // It is where a document lands when it is moved out of a folder, and
    // somebody needs to see it arrive.
    const groups = groupByFolder([folder({})], [page({ folderId: "f1" })], []);
    expect(groups.some((g) => g.id === null)).toBe(true);
  });

  it("shows a folder with nothing in it", () => {
    // Making an empty folder and having it not appear is indistinguishable
    // from the creation failing.
    const groups = groupByFolder([folder({ id: "empty", name: "New" })], [], []);
    expect(groups.find((g) => g.id === "empty")).toBeTruthy();
  });

  it("puts the top level last when there are folders", () => {
    /*
     * On a job with folders the top level is the leftovers, and leading with
     * the leftovers buries the structure somebody made.
     */
    const groups = groupByFolder([folder({ id: "f1" })], [], []);
    expect(groups[groups.length - 1].id).toBeNull();
  });

  it("is just the top level when there are no folders at all", () => {
    const groups = groupByFolder([], [page({})], [file({})]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBeNull();
    expect(groupCount(groups[0])).toBe(2);
  });

  it("does not lose anything, whatever the arrangement", () => {
    const pages = [page({ id: "a", folderId: "f1" }), page({ id: "b", folderId: "gone" })];
    const files = [file({ id: "c" }), file({ id: "d", folderId: "f1" })];
    const groups = groupByFolder([folder({ id: "f1" })], pages, files);
    const total = groups.reduce((n, g) => n + groupCount(g), 0);
    expect(total).toBe(pages.length + files.length);
  });
});

describe("groupSummary", () => {
  it("says empty rather than zero", () => {
    expect(groupSummary({ id: null, name: "x", pages: [], files: [] })).toBe("Empty");
  });

  it("counts documents and files separately, because they are different things", () => {
    expect(groupSummary({ id: null, name: "x", pages: [page({})], files: [] })).toBe("1 document");
    expect(groupSummary({ id: null, name: "x", pages: [], files: [file({})] })).toBe("1 file");
    expect(
      groupSummary({
        id: null,
        name: "x",
        pages: [page({}), page({ id: "2" })],
        files: [file({})],
      }),
    ).toBe("2 documents, 1 file");
  });
});

describe("moveTargets", () => {
  const folders = [folder({ id: "f1", name: "Certs" }), folder({ id: "f2", name: "Photos" })];

  it("does not offer the folder a document is already in", () => {
    expect(moveTargets(folders, "f1").map((t) => t.id)).toEqual([null, "f2"]);
  });

  it("offers the top level, which is the only way back out of a folder", () => {
    expect(moveTargets(folders, "f1")[0]).toEqual({ id: null, name: "Not in a folder" });
  });

  it("does not offer the top level to something already there", () => {
    expect(moveTargets(folders, null).map((t) => t.id)).toEqual(["f1", "f2"]);
  });

  it("offers nothing when there is nowhere to go", () => {
    expect(moveTargets([], null)).toEqual([]);
  });
});

describe("folderNameError", () => {
  it("needs a name", () => {
    expect(folderNameError("")).toContain("Give the folder a name");
    expect(folderNameError("   ")).toContain("Give the folder a name");
  });

  it("mirrors the server's ceiling", () => {
    expect(folderNameError("x".repeat(MAX_FOLDER_NAME))).toBeNull();
    expect(folderNameError("x".repeat(MAX_FOLDER_NAME + 2))).toContain("2 characters");
  });

  it("refuses a duplicate, which the server would allow", () => {
    /*
     * A kindness rather than a rule: there is no unique constraint, so two
     * folders called "Certificates" is not an error. It is just impossible to
     * work with afterwards.
     */
    const existing = [folder({ name: "Certificates" })];
    expect(folderNameError("Certificates", existing)).toContain("already a folder");
    expect(folderNameError("  certificates  ", existing)).toContain("already a folder");
    expect(folderNameError("Photos", existing)).toBeNull();
  });
});

describe("deleteFolderWarning", () => {
  it("says a folder is empty when it is", () => {
    expect(deleteFolderWarning({ id: "f1", name: "New", pages: [], files: [] })).toContain(
      "It is empty",
    );
  });

  it("does not promise where the contents go", () => {
    /*
     * The service deletes the folder row and nothing else, and whether
     * `project_pages.folder_id` cascades or nulls is not declared anywhere in
     * this repo. Saying "they move to the top level" would be a guess presented
     * as a fact, and the one guess worth never making is about where somebody's
     * work went.
     */
    const warning = deleteFolderWarning({
      id: "f1",
      name: "Certs",
      pages: [page({}), page({ id: "2" })],
      files: [file({})],
    });
    expect(warning).toContain("3 items");
    expect(warning).toContain("Check the job afterwards");
    expect(warning).not.toMatch(/move to the top level|will be kept|are safe/i);
  });
});

describe("the phone reads the field names the service sends", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/projects/pages.ts"), "utf8");
  const client = () => readFileSync(join(process.cwd(), "apps/mobile/src/api/pages.ts"), "utf8");

  it("declares the document tree in the camelCase the service maps to", () => {
    /*
     * The regression this file exists for, and the third of its kind in this
     * port. `listProjectDocumentTree` does not return rows: it maps them
     * explicitly. The phone declared snake_case, so `file.file_name` was
     * `undefined` and every uploaded file drew with NO TITLE, while pages drew
     * with a blank timestamp and no folder name. It read as a styling fault.
     */
    const s = service();
    for (const field of [
      "folderId: p.folder_id",
      "fileName: f.file_name",
      "createdAt: f.created_at",
    ]) {
      expect(s, field).toContain(field);
    }
    const c = client();
    expect(c).toContain("folderId:");
    expect(c).toContain("fileName:");
    expect(c).not.toMatch(/^\s*file_name:/m);
  });

  it("keeps PageDetail snake_case, because that op really does return the row", () => {
    /*
     * The trap. Two ops over the same table with two conventions: the tree maps
     * its output, `getProjectPage` selects and returns the row. Converting both
     * to match would have broken the editor.
     */
    const s = service();
    const at = s.indexOf("export async function getProjectPageService");
    expect(s.slice(at, at + 600)).toContain("content_html");
    const c = client();
    expect(c).toContain("content_html: string;");
  });

  it("normalises the row that createDocumentFolder answers with", () => {
    /*
     * The one op in the folder group that returns a row rather than a mapped
     * shape, so a freshly made folder would otherwise render differently from
     * every other one until the next refetch.
     */
    const s = service();
    const at = s.indexOf("createDocumentFolderService");
    expect(s.slice(at, at + 400)).toContain('.select("id, project_id, name, created_at")');
    expect(client()).toContain("row.created_at");
  });

  it("sends the field names the four folder schemas read", () => {
    const s = service();
    const c = client();
    for (const field of ["folderId", "projectId", "name"]) {
      expect(s, `server ${field}`).toContain(field);
      expect(c, `client ${field}`).toContain(field);
    }
    // `moveDocument` takes a discriminator, not a table name.
    expect(s).toContain('kind: z.enum(["page", "file"])');
    expect(c).toContain('kind: "page" | "file"');
  });
});
