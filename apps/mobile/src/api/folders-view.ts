import type { DocumentFile, DocumentFolder, DocumentPage } from "./pages";

/**
 * Filing documents into folders.
 *
 * Import-free of React Native so the grouping and the naming rules can be
 * tested. The grouping is the part worth testing: a document filed into a
 * folder that no longer exists must not vanish from the screen, and that is
 * exactly what a naive `groupBy` does.
 */

/** Anything that can sit in a folder. */
export type Filed = { id: string; folderId: string | null };

export const MAX_FOLDER_NAME = 120;

/** Why this folder cannot be saved, or null. Mirrors the server's schema. */
export function folderNameError(name: string, existing: DocumentFolder[] = []): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the folder a name.";
  if (trimmed.length > MAX_FOLDER_NAME) {
    return `That name is ${trimmed.length - MAX_FOLDER_NAME} characters too long.`;
  }
  /*
   * The server allows duplicates and the database has no unique constraint, so
   * this is a kindness rather than a rule. Two folders called "Certificates" on
   * one job is not an error, it is just impossible to work with afterwards.
   */
  if (existing.some((folder) => folder.name.trim().toLowerCase() === trimmed.toLowerCase())) {
    return "There is already a folder with that name.";
  }
  return null;
}

/** A group of documents under one heading. */
export type FolderGroup = {
  /** Null for the top level. */
  id: string | null;
  name: string;
  pages: DocumentPage[];
  files: DocumentFile[];
};

/**
 * Documents arranged under their folders.
 *
 * Three rules, each of which is a bug if it goes the other way:
 *
 * **The top level always exists**, even when empty, because it is where a
 * document lands when it is moved out of a folder and somebody needs to see it
 * arrive.
 *
 * **A folder with nothing in it is still shown.** Making an empty folder and
 * having it not appear is indistinguishable from the creation failing.
 *
 * **An orphan is not lost.** A document whose `folderId` names a folder that is
 * no longer in the tree - deleted on the web a moment ago, or by somebody else
 * - falls back to the top level rather than disappearing from the screen
 * entirely. Its row is the only way anybody could file it again.
 */
export function groupByFolder(
  folders: DocumentFolder[],
  pages: DocumentPage[],
  files: DocumentFile[],
): FolderGroup[] {
  const known = new Set(folders.map((folder) => folder.id));
  const bucketOf = (item: Filed) =>
    item.folderId && known.has(item.folderId) ? item.folderId : null;

  const groups: FolderGroup[] = [
    { id: null, name: "Not in a folder", pages: [], files: [] },
    ...folders.map((folder) => ({ id: folder.id, name: folder.name, pages: [], files: [] })),
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));

  for (const page of pages) byId.get(bucketOf(page))?.pages.push(page);
  for (const file of files) byId.get(bucketOf(file))?.files.push(file);

  // The top level goes last: on a job with folders it is the leftovers, and
  // leading with the leftovers buries the structure somebody made.
  const [top, ...rest] = groups;
  return rest.length > 0 ? [...rest, top] : [top];
}

/** How many documents are in a group. */
export function groupCount(group: FolderGroup): number {
  return group.pages.length + group.files.length;
}

/** The line under a folder heading. */
export function groupSummary(group: FolderGroup): string {
  const count = groupCount(group);
  if (count === 0) return "Empty";
  const parts: string[] = [];
  if (group.pages.length) {
    parts.push(`${group.pages.length} document${group.pages.length === 1 ? "" : "s"}`);
  }
  if (group.files.length) {
    parts.push(`${group.files.length} file${group.files.length === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

/**
 * Where a document can be moved to, excluding where it already is.
 *
 * The top level counts as a destination, which is the only way to get something
 * back out of a folder.
 */
export function moveTargets(
  folders: DocumentFolder[],
  currentFolderId: string | null,
): { id: string | null; name: string }[] {
  const out: { id: string | null; name: string }[] = [];
  if (currentFolderId !== null) out.push({ id: null, name: "Not in a folder" });
  for (const folder of folders) {
    if (folder.id === currentFolderId) continue;
    out.push({ id: folder.id, name: folder.name });
  }
  return out;
}

/**
 * What the confirmation says before a folder is removed.
 *
 * Deliberately does not promise what happens to the contents. The service
 * deletes the folder row and nothing else, and whether `project_pages.folder_id`
 * cascades or nulls is not declared in this repo - so saying "the documents
 * inside will move to the top level" would be a guess presented as a fact, and
 * the one kind of guess worth never making is the one about where somebody's
 * work went.
 */
export function deleteFolderWarning(group: FolderGroup): string {
  const count = groupCount(group);
  if (count === 0) return `Delete the folder "${group.name}"? It is empty.`;
  return `Delete the folder "${group.name}"? It holds ${count} item${count === 1 ? "" : "s"}. Check the job afterwards to see where they went.`;
}
