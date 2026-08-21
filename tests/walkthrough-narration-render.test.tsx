import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AiNarratedPhotoSteps,
  WalkthroughNarratedPlayer,
  AiNarratedChip,
  activeChapterAt,
  type WalkthroughNarration,
} from "@/features/walkthroughs/components/WalkthroughNarration";
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

// The player's speech toggle asks the browser for a speech engine. Node has
// none, and the component must render the rest of itself regardless.
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
  it("shows the quote only for the photo that has one", () => {
    const html = renderToStaticMarkup(
      <AiNarratedPhotoSteps steps={steps} narration={narration()} />,
    );
    // p1 was spoken over, p2 was not: exactly one quote block.
    expect(html.match(/Heard on camera/g)).toHaveLength(1);
    expect(html).toContain("checking the flashing");
    expect(html).toContain("Nothing was said near this moment.");
  });

  it("renders a silent recording differently, and without apologising per tile", () => {
    const silent = narration({
      hasSpeech: false,
      photos: [
        { photoId: "p1", offsetSeconds: 20, narration: "A shot.", spoken: null },
        { photoId: "p2", offsetSeconds: 140, narration: "Another shot.", spoken: null },
      ],
    });
    const html = renderToStaticMarkup(<AiNarratedPhotoSteps steps={steps} narration={silent} />);
    expect(html).not.toContain("Heard on camera");
    // The "nothing was said" line belongs to a narrated walk with a quiet
    // moment. On a walk nobody spoke on it would repeat under every tile.
    expect(html).not.toContain("Nothing was said near this moment.");
    expect(html).toContain("Nobody spoke during this recording");
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

describe("WalkthroughNarratedPlayer", () => {
  const render = (over: Partial<WalkthroughNarration> = {}, s = steps, duration = 300) =>
    renderToStaticMarkup(
      <WalkthroughNarratedPlayer
        videoUrl="https://example.test/walk.webm"
        mimeType="video/webm"
        durationSeconds={duration}
        narration={narration(over)}
        steps={s}
      />,
    );

  it("renders the video, the rail and the AI treatment", () => {
    const html = render();
    expect(html).toContain("<video");
    expect(html).toContain("AI Summary");
    expect(html).toContain("AI narrated");
    expect(html).toContain("Roof flashing");
    expect(html).toContain("Moving to the north condensers.");
  });

  it("opens on the first chapter, captioned over the footage", () => {
    // currentTime starts at 0, so chapter 0 is the active one.
    const html = render();
    expect(html).toContain("Walking the roof flashing.");
  });

  it("says so rather than crashing when there are no chapters", () => {
    const html = render({ chapters: [] });
    expect(html).toContain("No narration chapters for this recording.");
    expect(html).toContain("<video");
  });

  it("renders without a photo strip when nothing was captured", () => {
    const html = render({}, []);
    expect(html).toContain("<video");
    expect(html).not.toContain("Jump to");
  });

  it("does not divide by a zero duration", () => {
    const html = render({}, steps, 0);
    expect(html).toContain("<video");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("omits the source tag when the mime type is unknown", () => {
    const html = renderToStaticMarkup(
      <WalkthroughNarratedPlayer
        videoUrl="https://example.test/walk.webm"
        mimeType={null}
        durationSeconds={300}
        narration={narration()}
        steps={steps}
      />,
    );
    expect(html).toContain("<video");
    expect(html).not.toContain("<source");
  });

  it("hides the read-aloud control where there is no speech engine", () => {
    // window is stubbed undefined above: a control that cannot work must not
    // be offered.
    expect(render()).not.toContain("Play AI narration");
  });

  it("never emits undefined or NaN into the markup", () => {
    const html = render();
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });
});

/*
 * Which chapter the rail highlights, at every point on the clock.
 *
 * The render pass above only ever sees t=0, because `currentTime` is internal
 * state driven by a `timeupdate` event no test fires. This is the function that
 * decides what the viewer is looking at for the rest of the recording.
 */
describe("activeChapterAt", () => {
  const chapters = [
    { start: 0, end: 60, title: "One", narration: "First." },
    { start: 60, end: 150, title: "Two", narration: "Second." },
    { start: 150, end: 300, title: "Three", narration: "Third." },
  ];

  it("opens on the first chapter", () => {
    expect(activeChapterAt(chapters, 0)).toBe(0);
  });

  it("advances exactly on the boundary, not a second late", () => {
    // The boundary second belongs to the chapter starting on it. A `>` here
    // would leave the rail a beat behind the footage all the way through.
    expect(activeChapterAt(chapters, 59.9)).toBe(0);
    expect(activeChapterAt(chapters, 60)).toBe(1);
    expect(activeChapterAt(chapters, 150)).toBe(2);
  });

  it("stays on the last chapter as the video runs out", () => {
    // Browsers report a currentTime a hair past the stored duration. Going
    // blank there makes the rail flicker at the end of every playback.
    expect(activeChapterAt(chapters, 299)).toBe(2);
    expect(activeChapterAt(chapters, 300)).toBe(2);
    expect(activeChapterAt(chapters, 400)).toBe(2);
  });

  it("reports no chapter when there are none", () => {
    expect(activeChapterAt([], 12)).toBe(-1);
  });

  it("never lands on nothing, even for a rail that starts late", () => {
    // `sealChapters` pulls the first start back to 0, so this should not
    // happen - but a stored payload from an older version might not have been
    // through it, and an unhighlighted rail is the worst-looking failure here.
    const late = [{ start: 30, end: 60, title: "Late", narration: "Late." }];
    expect(activeChapterAt(late, 0)).toBe(0);
    expect(activeChapterAt(late, 10)).toBe(0);
  });

  it("survives a negative time", () => {
    expect(activeChapterAt(chapters, -5)).toBe(0);
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

  it("drops it in the player header too", () => {
    const render = (aiGenerated: boolean) =>
      renderToStaticMarkup(
        <WalkthroughNarratedPlayer
          videoUrl="https://example.test/walk.webm"
          mimeType="video/webm"
          durationSeconds={300}
          narration={withFlag(aiGenerated)}
          steps={steps}
        />,
      );
    expect(render(true)).toContain("AI narrated");
    expect(render(false)).not.toContain("AI narrated");
    // The artefact is still a Summary, it just is not an AI one.
    expect(render(false)).toContain("Summary");
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
