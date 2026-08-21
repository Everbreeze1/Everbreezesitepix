import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SummaryPhotoNotes } from "@/features/walkthroughs/components/SummaryPhotoNotes";
import type { SummaryPhoto } from "@/lib/summaries.functions";

/*
 * The one list the summary page draws, rendered for real.
 *
 * This component is the whole of the client's "each note sitting directly next
 * to its matching photo, not narration and photos in two separate lists", and
 * nothing had ever executed it. The migrated rows make the edge cases concrete:
 * every one of them arrived with an empty note and a real caption.
 */

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

const render = (photos: SummaryPhoto[], props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<SummaryPhotoNotes photos={photos} {...(props as never)} />);

/**
 * Visible text only.
 *
 * Counting a phrase in raw markup counts it inside attributes too, and the
 * image's `alt` legitimately repeats the note - that is what a screen reader
 * needs. A duplication test has to look at what is on screen.
 */
const visible = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("SummaryPhotoNotes", () => {
  it("renders nothing when there are no photos", () => {
    // A summary with no photos should end after its prose, not with an empty
    // "Photos" heading.
    expect(render([])).toBe("");
  });

  it("puts the note on the photo's own card", () => {
    const html = render([photo()]);
    expect(html).toContain("Replaced the condenser fan");
    // One list, not a rail plus a gallery.
    expect(html.match(/<ol/g) ?? []).toHaveLength(1);
  });

  it("shows the quote only for a photo somebody spoke over", () => {
    const html = render([
      photo({ photoId: "a", spoken: "this is the condenser" }),
      photo({ photoId: "b", spoken: null }),
    ]);
    expect(html.match(/Heard on camera/g)).toHaveLength(1);
    expect(html).toContain("this is the condenser");
  });

  it("says so plainly when a photo has nothing recorded against it", () => {
    // 83 of the 113 migrated notes are genuinely blank, because the photo has
    // no caption either. Better to say it than to invent an activity.
    expect(render([photo({ note: "" })])).toContain("Nothing was recorded against this photo");
  });

  it("does not repeat the caption when it became the note", () => {
    /*
     * Summaries migrated out of `walkthroughs` have an empty note, so the read
     * path falls back to the caption. Printing the caption line as well would
     * show the same sentence twice on one card.
     */
    const html = render([photo({ note: "Condenser unit", caption: "Condenser unit" })]);
    expect(visible(html).match(/Condenser unit/g)).toHaveLength(1);
    expect(html).not.toContain("Caption:");
  });

  it("keeps a caption that says something the note does not", () => {
    const html = render([photo({ note: "Replaced the fan", caption: "Unit 4B, north side" })]);
    expect(html).toContain("Replaced the fan");
    expect(html).toContain("Unit 4B, north side");
  });

  it("hides timestamps on a summary with no recording behind it", () => {
    // Every photo-only summary carries offset 0, so a badge would stamp a
    // meaningless 0:00 on every tile.
    const html = render([photo({ offsetSeconds: 0 })], { timed: false });
    expect(html).not.toContain("0:00");
  });

  it("shows timestamps when there was a walk", () => {
    expect(render([photo({ offsetSeconds: 125 })], { timed: true })).toContain("2:05");
  });

  it("makes the timestamp a control only when there is a player to drive", () => {
    const withSeek = render([photo({ offsetSeconds: 30 })], { timed: true, onSeek: () => {} });
    const without = render([photo({ offsetSeconds: 30 })], { timed: true });
    expect(withSeek).toContain("<button");
    expect(without).not.toContain("<button");
  });

  it("handles a photo whose URL failed to sign", () => {
    const html = render([photo({ imageUrl: "" })]);
    expect(html).toContain("<svg");
    expect(html).not.toContain('src=""');
  });

  it("counts narrated photos in the header only when some are", () => {
    expect(render([photo({ spoken: "said it" })])).toContain("1 narrated");
    expect(render([photo()])).not.toContain("narrated");
  });

  it("never emits undefined or NaN", () => {
    const html = render([photo({ caption: null, spoken: null, note: "" })]);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });
});

/*
 * The Summaries list on the Walkthroughs tab.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: any) => (
    <a href={`/summaries/${params?.summaryId ?? ""}`}>{children}</a>
  ),
}));

const { ProjectSummaries } = await import("@/features/walkthroughs/components/ProjectSummaries");

const item = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  projectId: "proj",
  walkthroughId: null,
  title: "Willow Street - Summary",
  markdown: "## Overview",
  status: "ready",
  shareToken: null,
  createdAt: new Date(Date.now() - 3600_000).toISOString(),
  updatedAt: new Date().toISOString(),
  photoCount: 4,
  thumbUrl: "https://example.test/t.jpg",
  ...over,
});

describe("ProjectSummaries", () => {
  const show = (summaries: unknown[], props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ProjectSummaries
        summaries={summaries as never}
        onGenerateFromPhotos={() => {}}
        {...(props as never)}
      />,
    );

  it("offers a way in when the project has none", () => {
    const html = show([]);
    expect(html).toContain("No summaries yet");
    expect(html).toContain("Generate from photos");
  });

  it("links a row to the summary route, never to a walkthrough", () => {
    const html = show([item()]);
    expect(html).toContain('href="/summaries/s1"');
    expect(html).not.toContain("/walkthroughs/");
  });

  it("marks which summaries came from a recording", () => {
    expect(show([item({ walkthroughId: "w1" })])).toContain("From a walkthrough");
    // A photo-only summary must not imply a recording that does not exist.
    expect(show([item({ walkthroughId: null })])).not.toContain("From a walkthrough");
  });

  it("shows that a summary has been shared", () => {
    expect(show([item({ shareToken: "tok" })])).toContain("Shared");
    expect(show([item({ shareToken: null })])).not.toContain("Shared");
  });

  it("handles a summary with no photos and no thumbnail", () => {
    const html = show([item({ photoCount: 0, thumbUrl: null })]);
    expect(html).toContain("<svg");
    expect(html).toContain("0 photos");
    expect(html).not.toContain("undefined");
  });

  it("singularises one photo", () => {
    expect(show([item({ photoCount: 1 })])).toContain("1 photo<");
  });
});
