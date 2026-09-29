import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_SECTIONS,
  auditLabel,
  deleteConfirmMatches,
  feedbackStatusCounts,
  formatBytes,
  formatRate,
  formatUsd,
  normaliseFeedbackReport,
  notificationError,
  reasonError,
  SHARE_KIND_LABELS,
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
  it("leaves only table work to the web, not the one-account controls", () => {
    /*
     * Jon, 2026-09-29: "That admin page should reflect the controls we have on
     * the website." Deleting an account, granting platform admin and changing a
     * plan are on the phone now, behind the same reason prompt and the same
     * server capability checks. What stays on the web is selecting many rows
     * at once and reading a chart.
     */
    expect(WEB_ONLY_ADMIN.length).toBeGreaterThan(0);
    const all = WEB_ONLY_ADMIN.join(" ").toLowerCase();
    expect(all).not.toContain("deleting a user");
    expect(all).not.toContain("granting or removing platform admin");
    expect(all).toContain("bulk");
  });
});

describe("normaliseFeedbackReport", () => {
  it("reads the camelCase shape listFeedback actually sends", () => {
    /*
     * The service sends `createdAt`, `userAgent` and a nested `reporter`. The
     * phone read snake_case, so every report had no date, an Unknown origin
     * and "Nobody to reply to".
     */
    const r = normaliseFeedbackReport({
      id: "r9",
      status: "triaged",
      kind: "idea",
      source: "page",
      subject: "Dark mode",
      description: "Please",
      userAgent: "EverlumenApp v1 (ios 18) iPhone",
      createdAt: "2026-09-01T00:00:00.000Z",
      projectId: "p1",
      projectName: "Riverside",
      reporter: { id: "u7", name: "Sam", email: "sam@site.test" },
    });
    expect(r.created_at).toBe("2026-09-01T00:00:00.000Z");
    expect(r.user_id).toBe("u7");
    expect(r.email).toBe("sam@site.test");
    expect(canReply(r)).toBe(true);
    expect(reportOrigin(r)).toBe("(ios 18) iPhone");
  });

  it("still reads the old snake_case shape", () => {
    expect(normaliseFeedbackReport(report()).user_id).toBe("u1");
  });

  it("reads the summary's byStatus counts", () => {
    expect(feedbackStatusCounts({ byStatus: { new: 4 } })).toEqual({ new: 4 });
    expect(feedbackStatusCounts(null)).toEqual({});
  });
});

describe("the rest of the console", () => {
  it("offers every section of the web's admin navigation", () => {
    const web = readFileSync(
      join(process.cwd(), "apps/web/src/features/admin/pages/AdminLayout.tsx"),
      "utf8",
    );
    for (const section of ADMIN_SECTIONS) {
      expect(web).toContain(`to: "/admin/${section.id}"`);
      expect(
        existsSync(join(process.cwd(), `apps/mobile/app/(app)/admin/${section.id}.tsx`)),
        section.id,
      ).toBe(true);
    }
    expect(ADMIN_SECTIONS.map((s) => s.id)).toHaveLength(8);
  });

  it("asks for a reason the way the web does, three characters at least", () => {
    expect(reasonError("ok")).not.toBeNull();
    expect(reasonError("  T-1 ")).toBeNull();
  });

  it("checks the typed email before a delete, case-insensitively", () => {
    expect(deleteConfirmMatches("Sam@Site.test", " sam@site.test ")).toBe(true);
    expect(deleteConfirmMatches("sam@site.test", "sam@site")).toBe(false);
    expect(deleteConfirmMatches(null, "")).toBe(false);
  });

  it("checks a notification's audience before sending", () => {
    const base = { title: "New", audience: "all" as const, teamId: null, userId: null };
    expect(notificationError(base)).toBeNull();
    expect(notificationError({ ...base, title: " " })).toContain("title");
    expect(notificationError({ ...base, audience: "team" })).toContain("team");
    expect(notificationError({ ...base, audience: "user", userId: "u1" })).toBeNull();
  });

  it("labels audit actions as the web does", () => {
    expect(auditLabel("delete_user")).toBe("Deleted an account");
    expect(auditLabel("view_user")).toBe("Viewed a user");
  });

  it("never calls a portfolio page a showcase in the share filter", () => {
    expect(SHARE_KIND_LABELS.showcase.toLowerCase()).not.toContain("showcase");
  });

  it("formats sizes and money", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatRate(0.051)).toBe("5.1%");
  });
});
