import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AiNarratedPhotoSteps,
  AiNarratedChip,
  type WalkthroughNarration,
} from "@/features/walkthroughs/components/WalkthroughNarration";
import { WalkthroughVideo } from "@/features/walkthroughs/components/WalkthroughVideo";
import type { WalkthroughPhotoStep } from "@/components/WalkthroughReport";

/*
 * Render the premium Summary components for real.
 *
 * Everything else about this feature is checked by reading source text, which
 * cannot tell a component that renders from one that throws on its first
 * undefined. These two are new, they are the artefact the client is selling,
 * and nothing had ever executed them.
 *
 * `renderToStaticMarkup` runs the component body, `useState`, `useMemo` and
 * `useRef` - everything except effects and events. That is exactly the pass
 * that catches a crash on an empty array or a null field, which is what the
 * live data actually looks like: three quarters of the walkthroughs in this
 * product were recorded with nobody speaking.
 */

// Nothing here may need a browser to render.
vi.stubGlobal("window", undefined);

const narration = (over: Partial<WalkthroughNarration> = {}): WalkthroughNarration => ({
  version: 1,
  hasSpeech: true,
  headline: "Roof flashing and the north condensers.",
  chapters: [
    { start: 0, end: 120, title: "Roof flashing", narration: "Walking the roof flashing." },
    { start: 120, end: 300, title: "Condensers", narration: "Moving to the north condensers." },
  ],
  photos: [
    {
      photoId: "p1",
      offsetSeconds: 20,
      narration: "Flashing at the parapet.",
      spoken: "checking the flashing",
    },
    { photoId: "p2", offsetSeconds: 140, narration: "The north condensers.", spoken: null },
  ],
  aiGenerated: true,
  ...over,
});

const step = (
  id: string,
  offset: number,
  over: Partial<WalkthroughPhotoStep> = {},
): WalkthroughPhotoStep => ({
  photo_id: id,
  offset_seconds: offset,
  spoken_note: null,
  position: 0,
  caption: null,
  taken_at: null,
  image_url: `https://example.test/${id}.jpg`,
  ...over,
});

const steps = [step("p1", 20), step("p2", 140)];

describe("AiNarratedChip", () => {
  it("renders", () => {
    expect(renderToStaticMarkup(<AiNarratedChip />)).toContain("AI narrated");
  });
});

describe("AiNarratedPhotoSteps", () => {
  it("shows the AI's note for each photo, not what the camera heard", () => {
    // "On the pictures taken the AI hears the convo and writes its own notes.
    // we dont need to also write what the camera heard."
    const html = renderToStaticMarkup(
      <AiNarratedPhotoSteps steps={steps} narration={narration()} />,
    );
    expect(html).toContain("Flashing at the parapet.");
    expect(html).toContain("The north condensers.");
    expect(html).not.toContain("Heard on camera");
    expect(html).not.toContain("checking the flashing");
    expect(html).not.toContain("Nothing was said near this moment.");
  });

  it("renders nothing at all when there are no photos", () => {
    expect(renderToStaticMarkup(<AiNarratedPhotoSteps steps={[]} narration={narration()} />)).toBe(
      "",
    );
  });

  it("survives narration that has no entry for a photo", () => {
    // A walkthrough generated before narration existed, or a model reply that
    // dropped one. The tile must still render.
    const html = renderToStaticMarkup(
      <AiNarratedPhotoSteps steps={steps} narration={narration({ photos: [] })} />,
    );
    expect(html).toContain("<li");
    expect(html).not.toContain("undefined");
  });

  it("falls back to the older spoken_note when narration is missing", () => {
    const html = renderToStaticMarkup(
      <AiNarratedPhotoSteps
        steps={[step("p1", 20, { spoken_note: "legacy note from the old pipeline" })]}
        narration={narration({ photos: [] })}
      />,
    );
    expect(html).toContain("legacy note from the old pipeline");
  });

  it("does not print a filename as if it were a caption", () => {
    const html = renderToStaticMarkup(
      <AiNarratedPhotoSteps
        steps={[step("p1", 20, { caption: "IMG_1234.JPG" })]}
        narration={narration({ photos: [] })}
      />,
    );
    expect(html).not.toContain("IMG_1234");
  });

  it("handles a photo whose image failed to sign", () => {
    const html = renderToStaticMarkup(
      <AiNarratedPhotoSteps steps={[step("p1", 20, { image_url: "" })]} narration={narration()} />,
    );
    expect(html).toContain("<svg");
    expect(html).not.toContain('src=""');
  });

  it("formats offsets as mm:ss", () => {
    const html = renderToStaticMarkup(
      <AiNarratedPhotoSteps steps={[step("p1", 605)]} narration={narration({ photos: [] })} />,
    );
    expect(html).toContain("10:05");
  });
});

describe("WalkthroughVideo", () => {
  const render = (s = steps, duration = 300, mimeType: string | null = "video/webm") =>
    renderToStaticMarkup(
      <WalkthroughVideo
        videoUrl="https://example.test/walk.webm"
        mimeType={mimeType}
        durationSeconds={duration}
        steps={s}
      />,
    );

  it("renders the plain video and the photos taken along the way", () => {
    const html = render();
    expect(html).toContain("<video");
    expect(html).toContain("Photos from this walk");
    expect(html).toContain("Jump to 0:20");
    expect(html).toContain("2:20");
  });

  it("carries no AI voice-over or narration rail", () => {
    // "we dont need no out loud AI narration. that is only used to produce
    // automatic reports."
    const html = render();
    expect(html).not.toContain("Play AI narration");
    expect(html).not.toContain("Narration");
  });

  it("renders without a photo strip when nothing was captured", () => {
    const html = render([]);
    expect(html).toContain("<video");
    expect(html).not.toContain("Jump to");
  });

  it("does not divide by a zero duration", () => {
    const html = render(steps, 0);
    expect(html).toContain("<video");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("still gives the browser a source when the mime type is unknown", () => {
    const html = render(steps, 300, null);
    expect(html).toContain("<source");
    expect(html).not.toContain('type="null"');
  });

  it("never emits undefined or NaN into the markup", () => {
    const html = render();
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });
});

/*
 * The "AI narrated" badge is a claim about who wrote the words.
 *
 * Both the model and the deterministic builder produce the same shape, so the
 * only thing separating a premium artefact from a timestamp-and-caption stub is
 * `aiGenerated`. Badging the stub is the one failure here a customer would be
 * right to call dishonest, and it is invisible from the shape alone.
 */
describe("the AI claim", () => {
  const withFlag = (aiGenerated: boolean) => narration({ aiGenerated });

  it("badges narration a model actually wrote", () => {
    const html = renderToStaticMarkup(
      <AiNarratedPhotoSteps steps={steps} narration={withFlag(true)} />,
    );
    expect(html).toContain("AI narrated");
    expect(html).toContain("AI narration");
  });

  it("drops the badge when the model was unavailable", () => {
    const html = renderToStaticMarkup(
      <AiNarratedPhotoSteps steps={steps} narration={withFlag(false)} />,
    );
    expect(html).not.toContain("AI narrated");
    expect(html).not.toContain("AI narration");
    // Still says where the words came from, and how to get the real thing.
    expect(html).toContain("From this shot");
    expect(html).toContain("Regenerate the summary");
  });

  it("keeps the badge for a payload stored before the flag was trustworthy", () => {
    // Only an explicit `false` withdraws the claim: older rows were written
    // when `aiGenerated` was effectively hardcoded, so a missing value must
    // not silently demote a real AI summary.
    const legacy = { ...narration(), aiGenerated: undefined } as unknown as WalkthroughNarration;
    expect(
      renderToStaticMarkup(<AiNarratedPhotoSteps steps={steps} narration={legacy} />),
    ).toContain("AI narrated");
  });
});
