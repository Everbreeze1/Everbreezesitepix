import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import {
  FillField,
  MergeToken,
  adjacentFillFieldRange,
  FILL_FIELD_NAME,
} from "../apps/web/src/lib/tiptap-fill-field";

/*
 * Tab between the blanks of a filled-in template.
 *
 * The client's report: "when I have to fill in the rest of the form, I have to
 * click out and click back into another field to type. I should be able to hit
 * tab and it should jump into other fields as I am filling them."
 *
 * The blanks are one inline node inside a single contenteditable, not inputs,
 * so there was no tab order to walk. What the schema below reproduces is the
 * shape of the HVAC Service Call template: two tables of one blank per cell,
 * then prose blanks underneath.
 */

const schema: Schema = getSchema([
  StarterKit,
  FillField,
  MergeToken,
  Table,
  TableRow,
  TableHeader,
  TableCell,
]);

function field(label: string, text?: string) {
  return {
    type: FILL_FIELD_NAME,
    attrs: { label },
    ...(text ? { content: [{ type: "text", text }] } : {}),
  };
}

function cell(...content: unknown[]) {
  return { type: "tableCell", content: [{ type: "paragraph", content }] };
}

function paragraph(...content: unknown[]) {
  return { type: "paragraph", content };
}

function doc(...content: unknown[]): ProseMirrorNode {
  return schema.nodeFromJSON({ type: "doc", content });
}

/** Every fill field start position, in document order. */
function fieldStarts(d: ProseMirrorNode): number[] {
  const out: number[] = [];
  d.descendants((node, pos) => {
    if (node.type.name !== FILL_FIELD_NAME) return true;
    out.push(pos);
    return false;
  });
  return out;
}

/** Where the caret sits when someone is typing at the end of a blank. */
function insideField(d: ProseMirrorNode, start: number): number {
  const node = d.nodeAt(start);
  if (!node) throw new Error(`no node at ${start}`);
  return start + 1 + node.content.size;
}

describe("adjacentFillFieldRange", () => {
  it("walks the blanks of a table row in document order", () => {
    const d = doc({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            cell({ type: "text", text: "Buddy Jones" }),
            cell(field("WO number")),
            cell(field("Time")),
          ],
        },
      ],
    });

    const starts = fieldStarts(d);
    expect(starts).toHaveLength(2);

    const next = adjacentFillFieldRange(d, insideField(d, starts[0]), 1);
    expect(next).toEqual({ from: starts[1] + 1, to: starts[1] + 1 });
  });

  it("crosses out of one table and into the next block", () => {
    const d = doc(
      {
        type: "table",
        content: [{ type: "tableRow", content: [cell(field("Serial")), cell(field("Size"))] }],
      },
      paragraph({ type: "text", text: "Reported problem " }, field("What the customer said")),
    );

    const starts = fieldStarts(d);
    expect(starts).toHaveLength(3);

    // The last cell of the table. Tiptap's Table extension answers Tab here by
    // appending a row; this has to reach the prose blank underneath instead.
    const next = adjacentFillFieldRange(d, insideField(d, starts[1]), 1);
    expect(next).toEqual({ from: starts[2] + 1, to: starts[2] + 1 });
  });

  it("selects the whole of a blank that already has a value", () => {
    const d = doc(paragraph(field("Unit")), paragraph(field("Make", "Carrier")));

    const starts = fieldStarts(d);
    const next = adjacentFillFieldRange(d, insideField(d, starts[0]), 1);
    // "Carrier" is seven characters, so the range covers it the way tabbing
    // into a form input selects what is already typed there.
    expect(next).toEqual({ from: starts[1] + 1, to: starts[1] + 1 + 7 });

    const selected = d.textBetween(next!.from, next!.to);
    expect(selected).toBe("Carrier");
  });

  it("goes backwards for Shift-Tab", () => {
    const d = doc(paragraph(field("Unit"), field("Type"), field("Make")));

    const starts = fieldStarts(d);
    const previous = adjacentFillFieldRange(d, insideField(d, starts[2]), -1);
    expect(previous).toEqual({ from: starts[1] + 1, to: starts[1] + 1 });
  });

  it("steps over merge tokens, which are read-only pills", () => {
    const d = doc(
      paragraph(
        field("Unit"),
        { type: "mergeToken", attrs: { token: "project_name", label: "Buddy" } },
        field("Type"),
      ),
    );

    const starts = fieldStarts(d);
    expect(starts).toHaveLength(2);
    const next = adjacentFillFieldRange(d, insideField(d, starts[0]), 1);
    expect(next).toEqual({ from: starts[1] + 1, to: starts[1] + 1 });
  });

  it("hands Tab back when the caret is not in a blank", () => {
    const d = doc(paragraph({ type: "text", text: "Readings first" }), paragraph(field("Unit")));

    // Inside the plain paragraph. Tab there is still ordinary editing, so the
    // table and list keymaps below this one must still get their turn.
    expect(adjacentFillFieldRange(d, 3, 1)).toBeNull();
  });

  it("hands Tab back beside a blank rather than in it", () => {
    const d = doc(paragraph(field("Unit"), { type: "text", text: " ok" }, field("Type")));

    const starts = fieldStarts(d);
    // Immediately before the first field: the caret is in the paragraph.
    expect(adjacentFillFieldRange(d, starts[0], 1)).toBeNull();
  });

  it("does not wrap around at either end", () => {
    const d = doc(paragraph(field("Unit")), paragraph(field("Type")));

    const starts = fieldStarts(d);
    expect(adjacentFillFieldRange(d, insideField(d, starts[1]), 1)).toBeNull();
    expect(adjacentFillFieldRange(d, insideField(d, starts[0]), -1)).toBeNull();
  });

  it("keeps its own position when the caret is at the start of a blank", () => {
    // This is where the previous Tab left the caret on an empty field, so the
    // next Tab has to move on from here rather than find nothing.
    const d = doc(paragraph(field("Unit")), paragraph(field("Type")));

    const starts = fieldStarts(d);
    const next = adjacentFillFieldRange(d, starts[0] + 1, 1);
    expect(next).toEqual({ from: starts[1] + 1, to: starts[1] + 1 });
  });
});

describe("FillField extension wiring", () => {
  it("outranks the Table extension so Tab is answered here first", () => {
    // Tiptap orders keymap plugins by descending priority and ProseMirror stops
    // at the first handler returning true. Table's default is 100, and its Tab
    // both selects a whole cell and appends a row off the end of the table.
    const tablePriority = (Table.config as { priority?: number }).priority ?? 100;
    const fieldPriority = (FillField.config as { priority?: number }).priority ?? 100;
    expect(fieldPriority).toBeGreaterThan(tablePriority);
  });

  it("binds Tab and Shift-Tab", () => {
    const shortcuts = Object.keys(
      (
        FillField.config as {
          addKeyboardShortcuts?: () => Record<string, unknown>;
        }
      ).addKeyboardShortcuts?.call({ editor: null }) ?? {},
    );
    expect(shortcuts).toContain("Tab");
    expect(shortcuts).toContain("Shift-Tab");
  });
});
