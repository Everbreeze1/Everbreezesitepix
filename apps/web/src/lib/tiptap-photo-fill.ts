/**
 * Working out which node a picked photo belongs in.
 *
 * Split out of ProjectPageEditorPage so the "where does this photo go?"
 * arithmetic can be exercised without a browser. It is the part that, when it
 * quietly answered "nowhere in particular", left photos stranded beside the
 * empty "Click to add" box they were meant to fill.
 */
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, type Selection } from "@tiptap/pm/state";
import { isPhotoSlot } from "./tiptap-project-image";

/** A photo slot - or an already-filled photo - captured when the picker opened. */
export interface SlotTarget {
  pos: number;
  node: ProseMirrorNode;
}

/** Same image, by the two attributes that identify one in a document. */
function isSameImage(node: ProseMirrorNode | null | undefined, target: ProseMirrorNode): boolean {
  return (
    !!node &&
    node.type.name === "image" &&
    node.attrs.src === target.attrs.src &&
    node.attrs.alt === target.attrs.alt
  );
}

/**
 * Where `target` sits in `doc` now, or null if it has left the document.
 *
 * The position captured when the picker opened is only trusted while the same
 * image is still standing there. If the document shifted underneath the open
 * dialog - an undo, a reload, an edit elsewhere - the slot is found by identity
 * instead, so a photo can never be written over some unrelated node that
 * happens to have inherited the position.
 *
 * A document can hold several byte-identical slots (a seeded four-up row is
 * four copies of the same SVG), so identity alone cannot pick between them.
 * The match nearest the captured position wins, on the grounds that a document
 * which shifted moved everything by roughly the same amount. Twins remain
 * genuinely ambiguous - nothing short of a persisted per-slot id could
 * separate them - but that only matters if the document changes while the
 * picker is open, which no path in this app does.
 */
export function findImagePos(doc: ProseMirrorNode, target: SlotTarget): number | null {
  if (
    target.pos >= 0 &&
    target.pos < doc.content.size &&
    isSameImage(doc.nodeAt(target.pos), target.node)
  ) {
    return target.pos;
  }
  let nearest: number | null = null;
  doc.descendants((node, pos) => {
    if (!isSameImage(node, target.node)) return true;
    if (nearest === null || Math.abs(pos - target.pos) < Math.abs(nearest - target.pos)) {
      nearest = pos;
    }
    return true;
  });
  return nearest;
}

/**
 * An unfilled slot the selection is on or directly beside, if there is one.
 *
 * Inserting a photo slot row leaves the caret immediately after the slot, so
 * reaching for "Add photo" straight afterwards dropped the photo *next to* the
 * empty box rather than into it - the same stranded photo as the click-to-fill
 * bug, arrived at by a different button. A slot touching the insertion point is
 * a placeholder waiting for exactly this photo, so fill it rather than doubling
 * up. Anything further away is left alone: that is an ordinary insert.
 */
export function emptySlotNearSelection(doc: ProseMirrorNode, selection: Selection): number | null {
  const candidates =
    selection instanceof NodeSelection
      ? [selection.from]
      : selection.empty
        ? // The inline image just before the caret, then the one just after it.
          [selection.from - 1, selection.from]
        : [];
  for (const pos of candidates) {
    if (pos < 0 || pos >= doc.content.size) continue;
    const node = doc.nodeAt(pos);
    if (node?.type.name === "image" && isPhotoSlot(node.attrs)) return pos;
  }
  return null;
}
