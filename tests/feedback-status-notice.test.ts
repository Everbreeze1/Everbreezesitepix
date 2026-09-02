import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STATUS_NOTICE,
  quoteReport,
  reportReference,
  reportsNeedingNotice,
} from "../apps/api/src/domains/admin/feedback";

/**
 * The message a reporter gets when their report moves.
 *
 * Reported by a customer: "bugs I have submitted that are marked resolved are
 * not showing for me". Pressing Resolved used to write a column and tell
 * nobody, so this is the half that reaches them. It is guarded with real
 * assertions rather than by reading the source, because the rest of the
 * feedback tests can only prove the code exists, not that it says the right
 * thing to the right person.
 */

describe("which moves are worth telling a reporter about", () => {
  it("covers every status a report can be moved to except one", () => {
    expect(Object.keys(STATUS_NOTICE).sort()).toEqual(["dismissed", "resolved", "triaged"]);
  });

  it("says nothing when a report is moved back to new", () => {
    /*
     * The deliberate omission, and the one worth a test of its own. Moving
     * something back to 'new' is the queue correcting itself - usually a
     * misclick being undone. Announcing "your fixed bug is unfixed again" on
     * the strength of that is worse than silence, and adding 'new' here is
     * exactly the sort of well-meaning completion a later edit would make.
     */
    expect(STATUS_NOTICE).not.toHaveProperty("new");
    expect(STATUS_NOTICE["new" as keyof typeof STATUS_NOTICE]).toBeUndefined();
  });

  it("gives every notice a title and a lead that read as sentences", () => {
    for (const [status, notice] of Object.entries(STATUS_NOTICE)) {
      expect(notice!.title.length, `${status} title`).toBeGreaterThan(8);
      expect(notice!.lead.length, `${status} lead`).toBeGreaterThan(8);
      // The title becomes a notification headline, so it must not trail off.
      expect(notice!.title.endsWith("."), `${status} title ends with a full stop`).toBe(false);
      expect(notice!.lead.trim(), `${status} lead is trimmed`).toBe(notice!.lead);
    }
  });

  it("tells a dismissed reporter what to do next", () => {
    // "Closed without a change" on its own reads as a brush-off. The route
    // back has to be in the message, because there is nowhere else to put it.
    expect(STATUS_NOTICE.dismissed!.lead.toLowerCase()).toContain("again");
  });
});

describe("quoting the report back", () => {
  it("says nothing at all when there is no text", () => {
    // A one-tap thumbs signal carries no description. An empty pair of quotes
    // dangling off the end of the sentence would read as a rendering failure.
    for (const empty of [null, "", "   ", "\n\t "]) {
      expect(quoteReport(empty)).toBe("");
    }
  });

  it("quotes a short report whole", () => {
    expect(quoteReport("Generate spins forever.")).toBe(' "Generate spins forever."');
  });

  it("collapses the whitespace a pasted report arrives with", () => {
    // The fallback path in lib/feedback.ts folds device context into the
    // description as multiple lines, so multi-line text is normal here. Both
    // notification surfaces render into a single clamped paragraph, where a
    // raw newline would collapse to a space anyway.
    expect(quoteReport("line one\nline two\n\n\tline three")).toBe(
      ' "line one line two line three"',
    );
  });

  it("truncates a long report and still closes the quote", () => {
    const long = "x".repeat(500);
    const out = quoteReport(long);
    expect(out.endsWith('…"')).toBe(true);
    expect(out.startsWith(' "')).toBe(true);
    // Both surfaces clamp the body to two lines; the whole point of the cut is
    // that the lead plus the quote survives that clamp in the 360px bell.
    expect(out.length).toBeLessThan(90);
  });

  it("keeps the opening and closing quote balanced at every length", () => {
    for (const n of [1, 40, 79, 80, 81, 200]) {
      const out = quoteReport("y".repeat(n));
      expect((out.match(/"/g) ?? []).length, `length ${n}`).toBe(2);
    }
  });

  it("leaves the reporter's own words identifiable", () => {
    // The quote exists so someone with several open reports can tell which one
    // moved. The opening words are what does that, so they must survive.
    const report = "The Generate report button spins for a minute and then shows an error";
    expect(quoteReport(`${report} about the PDF service being unavailable`)).toContain(
      "The Generate report button spins",
    );
  });
});

describe("who actually gets told", () => {
  const row = (id: string, user_id: string | null, status: string) => ({ id, user_id, status });

  it("skips a report filed from a signed-out session", () => {
    // There is nobody to notify, and insertNotification would return early
    // anyway - but silently, which is how the original bug went unnoticed.
    const rows = [row("a", null, "new"), row("b", "u1", "new")];
    expect(reportsNeedingNotice(rows, "resolved").map((r) => r.id)).toEqual(["b"]);
  });

  it("skips a report already sitting in the status it is moved to", () => {
    const rows = [row("a", "u1", "resolved"), row("b", "u2", "new")];
    expect(reportsNeedingNotice(rows, "resolved").map((r) => r.id)).toEqual(["b"]);
  });

  it("tells nobody when a bulk move changes nothing", () => {
    const rows = [row("a", "u1", "resolved"), row("b", "u2", "resolved")];
    expect(reportsNeedingNotice(rows, "resolved")).toEqual([]);
  });

  it("notifies every distinct reporter in a bulk move", () => {
    // The input schema accepts up to 100 ids, and they need not share a
    // reporter. Each one is a separate person waiting on a separate bug.
    const rows = [row("a", "u1", "new"), row("b", "u2", "triaged"), row("c", "u3", "new")];
    expect(reportsNeedingNotice(rows, "resolved").map((r) => r.user_id)).toEqual([
      "u1",
      "u2",
      "u3",
    ]);
  });

  it("survives the read coming back empty or null", () => {
    // The before-read is deliberately not error-checked: a failure there must
    // not block the status update the admin actually asked for.
    expect(reportsNeedingNotice(null, "resolved")).toEqual([]);
    expect(reportsNeedingNotice(undefined, "resolved")).toEqual([]);
    expect(reportsNeedingNotice([], "resolved")).toEqual([]);
  });
});

describe("a notice names the report it is about", () => {
  /*
   * Found in this workspace's own inbox: two notifications, identical title and
   * identical body -
   *
   *     Your report was resolved
   *     This has been fixed or answered.
   *
   * - for two different reports. `quoteReport` returns "" when there is no
   * description to quote, and 5 of the 42 reports on file have none, so the
   * body collapsed to the same sentence every time. Nothing on the row said
   * which report had moved, and the notification carries no entity id to follow
   * either.
   */
  it("quotes the report when there is something to quote", () => {
    const out = reportReference({
      description: "The templates tab is not user friendly.",
      kind: "bug",
      created_at: "2026-08-30T03:46:02.000Z",
    });
    expect(out).toContain("The templates tab is not user friendly.");
    // The quote is enough on its own; no need to also stamp the date on it.
    expect(out).not.toContain("30 Aug");
  });

  it("names it by kind and date when there is not", () => {
    const out = reportReference({
      description: "",
      kind: "bug",
      created_at: "2026-08-30T03:46:02.000Z",
    });
    expect(out).toContain("bug");
    expect(out).toContain("Aug");
  });

  it("tells two description-less reports apart", () => {
    /*
     * The actual point. Two reports filed on different days must not produce
     * the same sentence.
     */
    const first = reportReference({
      description: null,
      kind: "bug",
      created_at: "2026-08-30T00:00:00.000Z",
    });
    const second = reportReference({
      description: null,
      kind: "bug",
      created_at: "2026-07-12T00:00:00.000Z",
    });
    expect(first).not.toBe(second);
  });

  it("says nothing rather than something broken when it has nothing to work with", () => {
    expect(reportReference({})).toBe("");
    expect(reportReference({ description: null, kind: null, created_at: null })).toBe("");
    expect(reportReference({ description: "", kind: "", created_at: "not a date" })).toBe("");
  });

  it("is what the service actually sends", () => {
    /*
     * Caught by mutation: with only the cases above, reverting the call site to
     * `quoteReport(row.description)` left every test green while the notices
     * went back to being identical. The function was proved and its use was
     * not.
     *
     * The select matters as much as the call - `kind` and `created_at` are the
     * fallback's only inputs, and without them it silently returns "".
     */
    const service = readFileSync(
      join(process.cwd(), "apps/api/src/domains/admin/feedback.ts"),
      "utf8",
    );
    expect(service).toContain("${notice.lead}${reportReference(row)}");
    expect(service).toContain('.select("id, user_id, status, description, kind, created_at")');
  });

  it("still reads as one sentence", () => {
    // Appended straight onto the lead, so it has to carry its own leading space.
    const notice = STATUS_NOTICE.resolved!;
    const body = `${notice.lead}${reportReference({ kind: "bug", created_at: "2026-08-30T00:00:00.000Z" })}`;
    expect(body).toBe("This has been fixed or answered. (bug, 30 Aug)");
  });
});
