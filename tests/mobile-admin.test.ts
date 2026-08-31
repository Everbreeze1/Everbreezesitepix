import { describe, expect, it } from "vitest";
import {
  canReply,
  FEEDBACK_STATUSES,
  nextStatuses,
  normaliseStatus,
  queueHeadline,
  replyError,
  reportOrigin,
  reportSummary,
  STATUS_LABELS,
  WEB_ONLY_ADMIN,
  type FeedbackReport,
} from "../apps/mobile/src/api/admin-view";

/*
 * The platform admin console, phone half.
 *
 * The web console is twelve routes. This is four things a staff member wants
 * away from a desk: read the queue, move a report, answer it, check the system
 * is up. Everything irreversible stays on the web, and the screen says so.
 *
 * The gate itself (`checkIsPlatformAdmin`) lives in `admin.ts` because it is a
 * network call, but its failure direction is the important part and is asserted
 * there by construction: it returns false on any unexpected shape or error.
 */

const report = (over: Partial<FeedbackReport> = {}): FeedbackReport => ({
  id: "r1",
  status: "new",
  kind: "bug",
  sentiment: "bad",
  source: "page",
  feature: "/team",
  description: "The team screen does not load",
  url: "app://team",
  user_agent: "EverlumenApp v0.1.0 (android 14) Pixel 7",
  created_at: "2026-08-30T09:00:00.000Z",
  project_id: null,
  user_id: "u1",
  email: "sam@site.test",
  ...over,
});

describe("STATUS_LABELS", () => {
  it("names each status from the reporter's side, not the queue's", () => {
    /*
     * "Triaged" is internal vocabulary. What the label is actually telling
     * somebody is that their report has been read and not yet fixed.
     */
    expect(STATUS_LABELS.triaged.toLowerCase()).not.toContain("triaged");
    for (const status of FEEDBACK_STATUSES) {
      expect(STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});

describe("normaliseStatus", () => {
  it("passes the four the server allows", () => {
    for (const status of FEEDBACK_STATUSES) expect(normaliseStatus(status)).toBe(status);
  });

  it("falls back rather than sending something the enum rejects", () => {
    // `status` is a text column with a zod enum in front of it. A value from an
    // older row would fail the write with a parse error.
    expect(normaliseStatus("wontfix")).toBe("new");
    expect(normaliseStatus(null)).toBe("new");
  });
});

describe("nextStatuses", () => {
  it("offers every status except the one it is already in", () => {
    expect(nextStatuses("new")).not.toContain("new");
    expect(nextStatuses("new")).toHaveLength(FEEDBACK_STATUSES.length - 1);
  });

  it("still offers moving back to new", () => {
    /*
     * The queue correcting itself. The service deliberately does not notify the
     * reporter for that move, because telling somebody their fixed bug is
     * unfixed on the strength of a misclick is worse than saying nothing. That
     * asymmetry is the server's; the phone just offers the move.
     */
    expect(nextStatuses("resolved")).toContain("new");
  });
});

describe("canReply", () => {
  it("refuses a report with nobody to reply to", () => {
    /*
     * `replyToFeedback` delivers as a notification, not email, because the
     * reporter may have typed no address. A report from a signed-out session
     * has no `user_id`, and the service treats replying to it as an error.
     * Saying so before the tap beats a failure afterwards.
     */
    expect(canReply(report({ user_id: null }))).toBe(false);
    expect(canReply(report())).toBe(true);
  });

  it("does not accept an email address as a substitute", () => {
    // An address in the column is not a notification recipient. The service
    // keys on `user_id` and so does this.
    expect(canReply({ user_id: null })).toBe(false);
  });
});

describe("replyError", () => {
  it("requires something and caps at the op's limit", () => {
    expect(replyError("")).toContain("something");
    expect(replyError("   ")).toContain("something");
    expect(replyError("Fixed in the next build.")).toBeNull();
    expect(replyError("x".repeat(1001))).toContain("1000");
  });
});

describe("reportOrigin", () => {
  it("reads the app's own user agent back", () => {
    /*
     * Mobile reports compose their own UA in `feedback-view.ts`, so this reads
     * it rather than parsing a browser string. Knowing a bug is phone-only is
     * usually the first useful fact about it.
     */
    expect(reportOrigin(report())).toBe("(android 14) Pixel 7");
  });

  it("copes with an app report from a device that named itself poorly", () => {
    expect(reportOrigin({ user_agent: "EverlumenApp", url: null })).toBe("The app");
  });

  it("recognises an app report by its url when the UA is missing", () => {
    expect(reportOrigin({ user_agent: null, url: "app://team" })).toBe("The app");
  });

  it("calls anything else a browser, and says so when there is nothing", () => {
    expect(reportOrigin({ user_agent: "Mozilla/5.0 (Macintosh)", url: "https://x" })).toBe(
      "A browser",
    );
    expect(reportOrigin({ user_agent: null, url: null })).toBe("Unknown");
  });
});

describe("reportSummary", () => {
  it("leads with what the reporter would be told", () => {
    expect(reportSummary(report())).toContain(STATUS_LABELS.new);
  });

  it("says where it came from and which surface", () => {
    const line = reportSummary(report());
    expect(line).toContain("Pixel 7");
    expect(line).toContain("/team");
  });

  it("omits the surface when the report did not name one", () => {
    expect(reportSummary(report({ feature: null }))).not.toContain("·  ");
  });
});

describe("queueHeadline", () => {
  it("counts what is waiting, not the total", () => {
    /*
     * Somebody opening this wants to know whether anything needs them, not how
     * many reports have ever existed.
     */
    expect(queueHeadline({ new: 3, resolved: 200 })).toBe("3 not looked at");
    expect(queueHeadline({ new: 0, resolved: 200 })).toBe("Nothing waiting");
    expect(queueHeadline({})).toBe("Nothing waiting");
  });
});

describe("WEB_ONLY_ADMIN", () => {
  it("lists what the phone deliberately will not do", () => {
    /*
     * Listed so the screen can say it. Without that, a staff member concludes
     * the console is half-built rather than deliberately narrow, and goes
     * hunting for a delete button that is missing on purpose.
     */
    expect(WEB_ONLY_ADMIN.length).toBeGreaterThan(0);
    const all = WEB_ONLY_ADMIN.join(" ").toLowerCase();
    // The irreversible ones are the point of the list.
    expect(all).toContain("deleting");
    expect(all).toContain("platform admin");
  });
});
