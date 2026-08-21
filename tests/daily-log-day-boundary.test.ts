import { describe, it, expect } from "vitest";
import {
  dayKeyInZone,
  entriesFromHtml,
  sessionSectionHtml,
} from "../apps/api/src/domains/projects/daily-log";

/*
 * Whose day is a "Daily Log" a day of?
 *
 * The API runs in UTC and this product's users work afternoons in California.
 * Grouping on the server's own calendar day therefore filed a 6:30pm Wednesday
 * job under Thursday, and then appended Thursday morning's capture session to
 * the very same page - two work days merged into one record, for the seven
 * hours a day the two calendars disagree. A technician reading back "what did I
 * do Wednesday" got Wednesday evening plus Thursday morning, with no sign
 * anything had been merged.
 *
 * These are the cases that broke it. They use fixed offsets because that is
 * what the browser sends (`Date.prototype.getTimezoneOffset()`).
 */

/** Sacramento in summer: UTC-7, so getTimezoneOffset() reports 420. */
const PDT = 420;
/** Sacramento in winter: UTC-8. */
const PST = 480;
/** The server's own clock. */
const UTC = 0;
/** Somewhere east of Greenwich, where the sign flips: Sydney, UTC+10. */
const AEST = -600;

describe("dayKeyInZone", () => {
  it("keeps a California evening on the day the technician is living", () => {
    const wednesdayEvening = "2026-08-20T18:30:00-07:00";
    expect(dayKeyInZone(wednesdayEvening, PDT)).toBe("2026-08-20");
    // The bug, preserved as documentation: to the server this was already
    // Thursday.
    expect(dayKeyInZone(wednesdayEvening, UTC)).toBe("2026-08-21");
  });

  it("does not merge an evening job with the next morning's", () => {
    const wednesdayEvening = "2026-08-20T18:30:00-07:00";
    const thursdayMorning = "2026-08-21T09:15:00-07:00";
    expect(dayKeyInZone(wednesdayEvening, PDT)).not.toBe(dayKeyInZone(thursdayMorning, PDT));
    // Same two instants, on the server's clock, were one day.
    expect(dayKeyInZone(wednesdayEvening, UTC)).toBe(dayKeyInZone(thursdayMorning, UTC));
  });

  it("does group a whole working day together", () => {
    const morning = "2026-08-20T07:05:00-07:00";
    const lunch = "2026-08-20T12:40:00-07:00";
    const evening = "2026-08-20T21:50:00-07:00";
    const days = [morning, lunch, evening].map((t) => dayKeyInZone(t, PDT));
    expect(new Set(days).size).toBe(1);
    expect(days[0]).toBe("2026-08-20");
  });

  it("handles the other side of Greenwich, where the offset is negative", () => {
    // Sydney, 9am Friday, is still Thursday 23:00 UTC.
    const fridayMorning = "2026-08-21T09:00:00+10:00";
    expect(dayKeyInZone(fridayMorning, AEST)).toBe("2026-08-21");
    expect(dayKeyInZone(fridayMorning, UTC)).toBe("2026-08-20");
  });

  it("works off standard time as well as daylight time", () => {
    const decemberEvening = "2026-12-15T17:10:00-08:00";
    expect(dayKeyInZone(decemberEvening, PST)).toBe("2026-12-15");
  });

  it("puts midnight itself on the new day, not the old one", () => {
    expect(dayKeyInZone("2026-08-21T00:00:00-07:00", PDT)).toBe("2026-08-21");
    expect(dayKeyInZone("2026-08-20T23:59:59-07:00", PDT)).toBe("2026-08-20");
  });

  it("accepts a Date as readily as an ISO string", () => {
    const iso = "2026-08-20T18:30:00-07:00";
    expect(dayKeyInZone(new Date(iso), PDT)).toBe(dayKeyInZone(iso, PDT));
  });

  it("returns empty rather than 'NaN-NaN-NaN' for an unparseable value", () => {
    // A bad value must not become a day key that silently matches nothing, or
    // worse, matches another bad one and appends to the wrong page.
    expect(dayKeyInZone("not a date", PDT)).toBe("");
    expect(dayKeyInZone("", PDT)).toBe("");
  });
});

/*
 * The Capture-flow card reads its bullets out of the stored HTML.
 *
 * That HTML is not all ours. The card has to render logs written by generators
 * that predate this module, and logs a technician has since edited by hand in
 * the rich text editor. These three shapes are taken from real rows.
 */
describe("entriesFromHtml", () => {
  it("reads the current generator's output", () => {
    const html =
      '<div data-panel="meta"><p><span class="panel-label">Daily Log</span>Internal only - not shared with clients</p></div>' +
      "<h2>14:32 - Photos captured</h2>" +
      "<ul><li><p>Replaced condensate pump, unit 4B</p></li><li><p>Cleared drain line</p></li></ul>" +
      '<p><img data-photo-id="abc" src="" width="23%" height="130"></p>';
    expect(entriesFromHtml(html)).toEqual([
      "Replaced condensate pump, unit 4B",
      "Cleared drain line",
    ]);
  });

  it("reads a body whose masthead is an InfoPanel", () => {
    const html =
      '<div data-panel="meta"><p>ProjectDindia Gupta</p><p>Prepared byMike</p></div>' +
      "<h2>What was done</h2><ul><li><p>Added refrigerant to outdoor unit.</p></li></ul>";
    // The masthead is not a bullet, so none of it leaks into the card.
    expect(entriesFromHtml(html)).toEqual(["Added refrigerant to outdoor unit."]);
  });

  it("reads a pre-InfoPanel body", () => {
    const html =
      "<p><strong>Project Name:</strong> Tire Busters</p><h2>Overview</h2>" +
      "<ul><li><p>Photo 1: Recorded at the Tire Busters site</p></li></ul>";
    expect(entriesFromHtml(html)).toEqual(["Photo 1: Recorded at the Tire Busters site"]);
  });

  it("never leaks markup or entities into the card", () => {
    const html =
      "<ul><li><p>Cleaned <strong>coil</strong> &amp; checked &lt;filter&gt;</p></li></ul>";
    expect(entriesFromHtml(html)).toEqual(["Cleaned coil & checked <filter>"]);
  });

  it("collapses the whitespace a rich text editor leaves behind", () => {
    const html = "<ul><li><p>  Two   spaces\n  and a newline  </p></li></ul>";
    expect(entriesFromHtml(html)).toEqual(["Two spaces and a newline"]);
  });

  it("returns nothing for a body with no bullets at all", () => {
    // Two real logs are like this. The card has its own line for it rather than
    // rendering an empty list.
    expect(entriesFromHtml("<h2>Overview</h2><p></p>")).toEqual([]);
    expect(entriesFromHtml(null)).toEqual([]);
    expect(entriesFromHtml("")).toEqual([]);
  });
});

/*
 * What one capture session looks like in the technician's document.
 *
 * The riskiest string code in the module: it splices model output, escaped
 * fallback text and photo placeholders into HTML that the rich text editor,
 * the PDF renderer and the Capture-flow card all have to read back.
 */
describe("sessionSectionHtml", () => {
  const base = {
    time: "14:32",
    source: "camera" as const,
    markdown: "",
    entries: ["Replaced condensate pump, unit 4B"],
    photoIds: ["11111111-1111-1111-1111-111111111111"],
  };

  it("heads the section with the time and how the photos arrived", () => {
    expect(sessionSectionHtml(base)).toContain("<h2>14:32 - Photos captured</h2>");
    expect(sessionSectionHtml({ ...base, source: "upload" })).toContain(
      "<h2>14:32 - Photos uploaded</h2>",
    );
  });

  it("drops the model's redundant heading but keeps the informative one", () => {
    // Stacked under the timestamp, "What was done" was two full-size headings
    // in a row saying the same thing. "Follow-ups" says something new.
    const html = sessionSectionHtml({
      ...base,
      markdown:
        "## What was done\n\n- Replaced condensate pump\n\n## Follow-ups\n\n- Order a filter\n",
    });
    expect(html).not.toMatch(/<h2>14:32 - Photos captured<\/h2>\s*<h2>/);
    expect(html).toContain("Follow-ups");
    expect(html).toContain("Replaced condensate pump");
  });

  it("strips a title the model was told not to write", () => {
    const html = sessionSectionHtml({ ...base, markdown: "# Daily Log\n\n- Did a thing\n" });
    expect(html).not.toContain("<h1>");
    expect(html).toContain("Did a thing");
  });

  it("falls back to the deterministic entries when the model gave nothing", () => {
    const html = sessionSectionHtml(base);
    expect(html).toContain("<li><p>Replaced condensate pump, unit 4B</p></li>");
  });

  it("escapes the fallback entries, which are user text", () => {
    // Captions come from the field and land here verbatim.
    const html = sessionSectionHtml({
      ...base,
      entries: ['Checked <script>alert(1)</script> & the "main" unit'],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("writes photos as placeholders, never as signed URLs", () => {
    // Signed storage URLs expire; `resolvePageImages` re-signs from the id on
    // every read. A baked URL is a photo that turns into a broken image.
    const html = sessionSectionHtml(base);
    expect(html).toContain('data-photo-id="11111111-1111-1111-1111-111111111111"');
    expect(html).toContain('src=""');
    expect(html).not.toContain("http");
  });

  it("omits the photo strip when the session added none", () => {
    const html = sessionSectionHtml({ ...base, photoIds: [] });
    expect(html).not.toContain("<img");
    expect(html).toContain("<h2>");
  });

  it("round-trips through the card's own parser", () => {
    // The two halves of this module have to agree: whatever is written here is
    // what the Capture-flow card reads back out.
    const html = sessionSectionHtml({
      ...base,
      markdown: "## What was done\n\n- Replaced condensate pump\n- Cleared drain line\n",
    });
    expect(entriesFromHtml(html)).toEqual(["Replaced condensate pump", "Cleared drain line"]);
  });
});
