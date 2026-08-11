import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ProjectImage } from "../apps/web/src/lib/tiptap-project-image";
import { findImagePos, emptySlotNearSelection } from "../apps/web/src/lib/tiptap-photo-fill";
import { photoRowHtml } from "../apps/web/src/lib/tiptap-photo-slot";

/*
 * Filling a document photo slot must REPLACE that slot. When the editor lost
 * track of which node was clicked it fell back to inserting at the caret, and
 * the photo appeared beside the still-empty "Click to add" box instead of
 * inside it. These are the two lookups that decide where a picked photo lands.
 */

const schema = getSchema([Document, Paragraph, Text, ProjectImage]);

/**
 * The `src` shape an unfilled slot carries — `isPhotoSlot` keys off this
 * prefix, so the row builder is asserted to still emit it.
 */
function slotSrc(label: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg><text>${label}</text></svg>`)}`;
}

it("photoRowHtml still emits slots this file can stand in for", () => {
  expect(photoRowHtml(1, 1)).toContain('src="data:image/svg+xml;utf8,');
  expect(photoRowHtml(1, 1)).toContain('alt="Photo slot 1"');
});

function slot(index: number): ProseMirrorNode {
  return schema.nodes.image.create({
    src: slotSrc(`Photo ${index}`),
    alt: `Photo slot ${index}`,
    width: "48%",
    height: 280,
  });
}

function photo(id: string): ProseMirrorNode {
  return schema.nodes.image.create({
    src: `https://cdn.example/${id}.jpg`,
    alt: "A caption",
    "data-photo-id": id,
  });
}

/** doc(p(...children)) — a slot row is a single paragraph of inline images. */
function docOf(...children: ProseMirrorNode[]): ProseMirrorNode {
  return schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, children));
}

describe("findImagePos — the clicked slot is the only place the photo may go", () => {
  it("finds the slot at the position captured when the picker opened", () => {
    const doc = docOf(slot(1), slot(2));
    // Paragraph opens at 0, so its inline children start at 1.
    const target = { pos: 2, node: doc.nodeAt(2)! };
    expect(findImagePos(doc, target)).toBe(2);
  });

  it("re-finds the slot by identity after the document shifted underneath it", () => {
    const before = docOf(slot(1), slot(2));
    const target = { pos: 2, node: before.nodeAt(2)! };
    // Something inserted an image ahead of it while the picker was open.
    const after = docOf(photo("new"), slot(1), slot(2));
    expect(after.nodeAt(2)).not.toBe(null);
    expect(findImagePos(after, target)).toBe(3);
  });

  it("returns null when the slot has left the document, rather than a wrong position", () => {
    const before = docOf(slot(1), slot(2));
    const target = { pos: 2, node: before.nodeAt(2)! };
    const after = docOf(slot(1));
    expect(findImagePos(after, target)).toBe(null);
  });

  it("never mistakes a different slot in the same row for the clicked one", () => {
    const doc = docOf(slot(1), slot(2));
    const target = { pos: 1, node: doc.nodeAt(1)! };
    expect(findImagePos(doc, target)).toBe(1);
  });

  it("picks the nearest twin when a row holds byte-identical slots", () => {
    // A seeded four-up row is four copies of the same SVG with the same alt,
    // so identity alone cannot tell them apart — proximity has to.
    const twin = () =>
      schema.nodes.image.create({ src: slotSrc("Wide shot"), alt: "Wide shot", width: "48%" });
    const before = docOf(twin(), twin(), twin(), twin());
    const target = { pos: 4, node: before.nodeAt(4)! };
    // The row lost a slot while the picker was open, so nothing matches at the
    // captured position any more.
    const after = docOf(twin(), twin());
    expect(findImagePos(after, target)).toBe(2);
  });

  it("finds an already-filled photo, so 'Change photo' swaps in place", () => {
    const doc = docOf(photo("a"), photo("b"));
    const target = { pos: 2, node: doc.nodeAt(2)! };
    expect(findImagePos(doc, target)).toBe(2);
  });
});

describe("emptySlotNearSelection — the toolbar must not strand a photo beside a slot", () => {
  /** A caret at `pos` in a document. */
  function withCaret(doc: ProseMirrorNode, pos: number): EditorState {
    return EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, pos),
    });
  }

  it("fills the slot the caret was left sitting after", () => {
    // Exactly where "Insert > Photo slot row" leaves the caret.
    const doc = docOf(slot(1));
    const state = withCaret(doc, 2);
    expect(emptySlotNearSelection(state.doc, state.selection)).toBe(1);
  });

  it("fills the slot the caret sits before", () => {
    const doc = docOf(slot(1));
    const state = withCaret(doc, 1);
    expect(emptySlotNearSelection(state.doc, state.selection)).toBe(1);
  });

  it("fills a slot that is selected outright", () => {
    const doc = docOf(slot(1));
    const state = EditorState.create({
      schema,
      doc,
      selection: NodeSelection.create(doc, 1),
    });
    expect(emptySlotNearSelection(state.doc, state.selection)).toBe(1);
  });

  it("leaves an ordinary caret alone, so a plain insert stays a plain insert", () => {
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, schema.text("hello")),
    );
    const state = withCaret(doc, 3);
    expect(emptySlotNearSelection(state.doc, state.selection)).toBe(null);
  });

  it("does not hijack a slot that is already filled", () => {
    const doc = docOf(photo("a"));
    const state = withCaret(doc, 2);
    expect(emptySlotNearSelection(state.doc, state.selection)).toBe(null);
  });

  it("does not reach past the neighbouring node", () => {
    const doc = docOf(slot(1), photo("a"));
    // Caret after the real photo — the slot is two nodes away, leave it be.
    const state = withCaret(doc, 3);
    expect(emptySlotNearSelection(state.doc, state.selection)).toBe(null);
  });
});
