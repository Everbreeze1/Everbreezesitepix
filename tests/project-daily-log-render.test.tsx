import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * The Capture-flow card, rendered.
 *
 * `Link` needs a router context this test has no business standing up, so it is
 * replaced with the anchor it becomes. Everything the card decides for itself -
 * whether to render at all, which log is "Today", how many bullets to show
 * before it stops, what to say when a log has no bullets - is the component's
 * own logic and runs untouched.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: any) => <a href={`/pages/${params?.pageId ?? ""}`}>{children}</a>,
}));

const { ProjectDailyLog, DAILY_LOG_INTERNAL_NOTICE } =
  await import("@/features/projects/components/ProjectDailyLog");

/** An ISO instant N hours ago, so "Today" means today wherever this runs. */
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

const log = (over: Record<string, unknown> = {}) => ({
  pageId: "page-1",
  title: "Willow Street - Daily Log",
  createdAt: hoursAgo(2),
  updatedAt: hoursAgo(1),
  entries: ["Replaced condensate pump, unit 4B", "Cleared drain line"],
  photoCount: 6,
  ...over,
});

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(<ProjectDailyLog projectId="proj-1" logs={[]} {...(props as any)} />);

describe("ProjectDailyLog", () => {
  it("renders nothing when the project has no log and none is coming", () => {
    // Otherwise every photo grid in the product carries a permanent empty box
    // explaining what would go in it.
    expect(render({ logs: [] })).toBe("");
  });

  it("carries the internal-only label", () => {
    // The requirement was "wherever it appears", and this is the surface a
    // technician sees most.
    expect(render({ logs: [log()] })).toContain(DAILY_LOG_INTERNAL_NOTICE);
    expect(DAILY_LOG_INTERNAL_NOTICE).toBe("Internal only - not shared with clients");
  });

  it("calls a log written today Today", () => {
    expect(render({ logs: [log()] })).toContain("Today");
  });

  it("dates a log from an earlier day instead", () => {
    const html = render({ logs: [log({ createdAt: daysAgo(3), updatedAt: daysAgo(3) })] });
    expect(html).not.toContain(">Today");
  });

  it("shows the bullets themselves, not just a link", () => {
    const html = render({ logs: [log()] });
    expect(html).toContain("Replaced condensate pump, unit 4B");
    expect(html).toContain("Cleared drain line");
  });

  it("stops at five bullets and says how many more there are", () => {
    const entries = Array.from({ length: 9 }, (_, i) => `Entry number ${i + 1}`);
    const html = render({ logs: [log({ entries })] });
    expect(html).toContain("Entry number 5");
    expect(html).not.toContain("Entry number 6");
    expect(html).toContain("4 more");
  });

  it("handles a log with no bullets rather than rendering an empty list", () => {
    // Two of the twelve real legacy logs are like this.
    const html = render({ logs: [log({ entries: [] })] });
    expect(html).toContain("No entries yet");
  });

  it("shows a spinner while the first session of the day is being written", () => {
    const html = render({ logs: [], generating: true });
    expect(html).toContain("Writing today");
    expect(html).not.toContain("undefined");
  });

  it("keeps showing the existing log while a new session is appended", () => {
    const html = render({ logs: [log()], generating: true });
    expect(html).toContain("Replaced condensate pump, unit 4B");
    expect(html).toContain("Adding this session");
  });

  it("collapses earlier days behind a count", () => {
    const html = render({
      logs: [
        log(),
        log({ pageId: "page-2", createdAt: daysAgo(1), title: "Yesterday" }),
        log({ pageId: "page-3", createdAt: daysAgo(2), title: "Two days ago" }),
      ],
    });
    expect(html).toContain("Earlier days (2)");
    // Collapsed by default: the earlier titles are not in the markup yet.
    expect(html).not.toContain("Two days ago");
  });

  it("links to the page editor for the log", () => {
    expect(render({ logs: [log()] })).toContain('href="/pages/page-1"');
  });

  it("singularises one photo", () => {
    expect(render({ logs: [log({ photoCount: 1 })] })).toContain("1 photo<");
  });

  it("never emits undefined or NaN", () => {
    const html = render({ logs: [log()] });
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("survives a log whose createdAt is unusable", () => {
    // Defensive: the field comes off a jsonb-ish payload and has been through
    // two serialisers.
    const html = render({ logs: [log({ createdAt: "not a date" })] });
    expect(html).toContain("Replaced condensate pump, unit 4B");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Invalid Date");
  });
});
