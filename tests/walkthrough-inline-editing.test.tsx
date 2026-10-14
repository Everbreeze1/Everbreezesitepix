import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { tiptapToMarkdown } from "@/lib/tiptap-markdown";
import { SummaryPhotoNotes } from "@/features/walkthroughs/components/SummaryPhotoNotes";
import type { SummaryPhoto } from "@/lib/summaries.functions";
import { updateWalkthroughSummaryService } from "../apps/api/src/domains/walkthroughs/summaries";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/*
 * "the summary should be editable on the spot. right now when i click to edit
 * summary i get that ugly window. i should be able to click on the comments on
 * any picture on the summary and edit it just in case something got recorded
 * wrong."
 */

const text = (t: string, marks: string[] = []) => ({
  type: "text",
  text: t,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const para = (...content: unknown[]) => ({ type: "paragraph", content });

describe("tiptapToMarkdown", () => {
  it("writes the editor back in the Markdown the summary is stored as", () => {
    const md = tiptapToMarkdown({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [text("Overview")] },
        para(text("Replaced the "), text("condenser fan", ["bold"]), text(" today.")),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [para(text("Coil cleaned"))] },
            { type: "listItem", content: [para(text("Filter "), text("changed", ["italic"]))] },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [
            { type: "listItem", content: [para(text("Order part"))] },
            { type: "listItem", content: [para(text("Book return visit"))] },
          ],
        },
      ],
    } as never);
    expect(md).toBe(
      [
        "## Overview",
        "Replaced the **condenser fan** today.",
        "- Coil cleaned\n- Filter *changed*",
        "1. Order part\n2. Book return visit",
      ].join("\n\n"),
    );
  });

  it("keeps spaces outside the bold markers", () => {
    // "** bold**" is not bold in Markdown, so a selection that took the space
    // with it must not end up as literal asterisks.
    const md = tiptapToMarkdown({
      type: "doc",
      content: [para(text("A"), text(" bold ", ["bold"]), text("word"))],
    } as never);
    expect(md).toBe("A **bold** word");
  });

  it("drops empty paragraphs and survives an empty document", () => {
    expect(tiptapToMarkdown({ type: "doc", content: [para(), para(text("Hi"))] } as never)).toBe(
      "Hi",
    );
    expect(tiptapToMarkdown(null)).toBe("");
  });
});

const photo = (over: Partial<SummaryPhoto> = {}): SummaryPhoto => ({
  photoId: "p1",
  offsetSeconds: 0,
  note: "Replaced the condenser fan",
  spoken: null,
  imageUrl: "https://example.test/p1.jpg",
  caption: null,
  takenAt: null,
  ...over,
});

describe("photo notes can be corrected in place", () => {
  it("turns each note into a click-to-edit control on the owner's page", () => {
    const html = renderToStaticMarkup(
      <SummaryPhotoNotes photos={[photo()]} onEditNote={async () => {}} />,
    );
    expect(html).toContain("Click a note to correct it");
    expect(html).toContain('title="Click to edit this note"');
    expect(html).toContain("Replaced the condenser fan");
  });

  it("stays read-only on the public share page", () => {
    const html = renderToStaticMarkup(<SummaryPhotoNotes photos={[photo()]} />);
    expect(html).not.toContain("Click to edit this note");
    expect(html).not.toContain("<button");
  });
});

/** A Supabase stand-in that holds one summary row. */
function fakeCtx(photoNotes: unknown[]) {
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { photo_notes: photoNotes }, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  return { ctx: { supabase } as never, updates };
}

const SUMMARY_ID = "00000000-0000-4000-8000-000000000001";

describe("updateWalkthroughSummaryService photoNote", () => {
  it("rewrites only the matching photo's note", async () => {
    const { ctx, updates } = fakeCtx([
      { photoId: "a", offsetSeconds: 3, note: "Wrong", spoken: "x" },
      { photoId: "b", offsetSeconds: 9, note: "Keep", spoken: null },
    ]);
    await updateWalkthroughSummaryService(ctx, {
      summaryId: SUMMARY_ID,
      photoNote: { photoId: "a", note: "  Right  " },
    });
    expect(updates).toEqual([
      {
        photo_notes: [
          { photoId: "a", offsetSeconds: 3, note: "Right", spoken: "x" },
          { photoId: "b", offsetSeconds: 9, note: "Keep", spoken: null },
        ],
      },
    ]);
  });

  it("refuses a photo that is not in the summary", async () => {
    const { ctx, updates } = fakeCtx([{ photoId: "a", note: "x" }]);
    await expect(
      updateWalkthroughSummaryService(ctx, {
        summaryId: SUMMARY_ID,
        photoNote: { photoId: "zzz", note: "y" },
      }),
    ).rejects.toThrow("not part of this summary");
    expect(updates).toHaveLength(0);
  });
});

describe("the summary page", () => {
  const src = read("apps/web/src/features/walkthroughs/pages/SummaryDetailPage.tsx");

  it("edits the text where it is read, not in a Markdown box", () => {
    expect(src).toContain("<EditableSummaryText");
    expect(src).not.toContain("Textarea");
    expect(src).not.toContain("setEditing");
    expect(src).toContain("onEditNote={saveNote}");
  });

  it("does not link back to the recording", () => {
    expect(src).not.toContain("Watch the walkthrough");
  });

  it("uses the full width like the rest of the app", () => {
    expect(src).not.toContain("max-w-3xl");
    expect(src).toContain("w-full");
  });
});

describe("the walkthrough cards", () => {
  const src = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");

  it("show the video's own thumbnail and no Open walkthrough link", () => {
    expect(src).toContain("cacheKey={`walk-card:${w.id}`}");
    expect(src).not.toContain("Open walkthrough");
  });
});
