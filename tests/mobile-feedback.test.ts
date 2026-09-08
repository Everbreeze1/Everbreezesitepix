import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptsAttachmentType,
  appendErrorLog,
  attachmentIssue,
  attachmentPath,
  cleanDescription,
  contextAsText,
  deviceUserAgent,
  FEEDBACK_BUCKET,
  feedbackRow,
  formatBytes,
  KINDS,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_DESCRIPTION,
  messageError,
  type DeviceContext,
  type PickedAttachment,
} from "../apps/mobile/src/api/feedback-view";

/*
 * Reporting a problem from the field.
 *
 * Two clients write `issue_reports`, and the column names are the thing to get
 * right: the web already shipped a bug where the text column was called
 * `message` instead of `description`, and its own comment says so. The last
 * block below checks the mobile row against the web's `baseRow` by reading it,
 * rather than by my having copied it carefully once.
 */

const context: DeviceContext = {
  platform: "android",
  osVersion: "14",
  model: "Pixel 7",
  appVersion: "0.1.0",
  screen: "/team",
};

describe("messageError", () => {
  it("requires something to act on", () => {
    expect(messageError("")).toContain("what happened");
    expect(messageError("   ")).toContain("what happened");
  });

  it("has a floor, not just a cap", () => {
    /*
     * "broken" is a report nobody can act on, and the person who sent it has
     * spent their goodwill without getting a fix. Asking for one more sentence
     * costs less than a round trip through support.
     */
    expect(messageError("broken")).toContain("sentence");
    expect(messageError("The team screen does not load")).toBeNull();
  });
});

describe("cleanDescription", () => {
  it("trims and caps to what the column takes", () => {
    expect(cleanDescription("  hello  ")).toBe("hello");
    expect(cleanDescription("x".repeat(5000))).toHaveLength(MAX_DESCRIPTION);
  });
});

describe("deviceUserAgent", () => {
  it("composes something an admin can read, rather than leaving it null", () => {
    /*
     * The column holds a browser UA from the web. An empty one on a mobile
     * report would make an admin work out from an absence that it came from the
     * app.
     */
    const ua = deviceUserAgent(context);
    expect(ua).toContain("EverlumenApp");
    expect(ua).toContain("android");
    expect(ua).toContain("Pixel 7");
  });

  it("survives a device that reports nothing about itself", () => {
    // `expo-device` returns null for the model on an emulator.
    const ua = deviceUserAgent({
      platform: "ios",
      osVersion: null,
      model: null,
      appVersion: null,
      screen: null,
    });
    expect(ua).toContain("EverlumenApp");
    expect(ua).not.toContain("null");
  });

  it("caps at 500, matching the web's slice", () => {
    const ua = deviceUserAgent({ ...context, model: "x".repeat(900) });
    expect(ua.length).toBeLessThanOrEqual(500);
  });
});

describe("appendErrorLog", () => {
  it("attaches the recent errors when asked", () => {
    /*
     * The reason `error-redaction.ts` exists. A crew member reporting "the team
     * screen did not work" cannot say what the error was, and until now nothing
     * on the phone could either.
     */
    const out = appendErrorLog("It broke", "query my-team\n  Request failed", true);
    expect(out).toContain("It broke");
    expect(out).toContain("Request failed");
  });

  it("leaves the report alone when not asked, or when there is nothing", () => {
    expect(appendErrorLog("It broke", "some errors", false)).toBe("It broke");
    expect(appendErrorLog("It broke", "   ", true)).toBe("It broke");
  });

  it("still respects the column cap once the log is attached", () => {
    const out = appendErrorLog("x".repeat(3900), "y".repeat(900), true);
    expect(out).toHaveLength(MAX_DESCRIPTION);
  });
});

describe("feedbackRow", () => {
  const row = () =>
    feedbackRow({
      kind: "bug",
      description: "The team screen does not load",
      userId: "u1",
      email: "sam@site.test",
      screen: "/team",
      context,
    });

  it("writes `description`, never `message`", () => {
    // The exact mistake the web already shipped once.
    const r = row();
    expect(r.description).toBe("The team screen does not load");
    expect(r).not.toHaveProperty("message");
  });

  it("groups by the screen, which is the axis the admin queue uses", () => {
    expect(row().feature).toBe("/team");
  });

  it("derives sentiment from the kind rather than asking twice", () => {
    expect(row().sentiment).toBe("bad");
    expect(
      feedbackRow({
        ...{ kind: "praise" as const },
        description: "d",
        userId: null,
        email: null,
        screen: null,
        context,
      }).sentiment,
    ).toBe("good");
    expect(
      feedbackRow({
        ...{ kind: "idea" as const },
        description: "d",
        userId: null,
        email: null,
        screen: null,
        context,
      }).sentiment,
    ).toBeNull();
  });

  it("puts an app URL in `url`, so a mobile report is identifiable", () => {
    expect(row().url).toBe("app://team");
  });

  it("copes with a report sent from nowhere in particular", () => {
    const r = feedbackRow({
      kind: "idea",
      description: "d",
      userId: null,
      email: null,
      screen: null,
      context,
    });
    expect(r.url).toBeNull();
    expect(r.feature).toBeNull();
  });
});

describe("contextAsText", () => {
  it("folds the structured context into the body for the retry", () => {
    /*
     * Migrations here are applied by hand, so `client_info` and `project_id`
     * may not be on the table yet. The web hit this and solved it the same way.
     */
    const text = contextAsText(context, "p1");
    expect(text).toContain("android 14");
    expect(text).toContain("Pixel 7");
    expect(text).toContain("p1");
  });

  it("omits what the device did not report, rather than writing null", () => {
    const text = contextAsText(
      { platform: "ios", osVersion: null, model: null, appVersion: null, screen: null },
      null,
    );
    expect(text).not.toContain("null");
    expect(text).toContain("ios");
  });
});

describe("KINDS", () => {
  it("describes each kind by what the reporter is telling you", () => {
    // "bug" and "idea" are our words. A person reports that something is
    // broken or missing.
    expect(KINDS.map((k) => k.id).sort()).toEqual(["bug", "idea", "praise"]);
    for (const kind of KINDS) expect(kind.hint.length).toBeGreaterThan(0);
  });
});

describe("attachment paths, written the way the admin console reads them", () => {
  it("uses the same shape the web uploader writes", () => {
    // attachmentName in apps/api/src/domains/admin/feedback.ts strips a
    // `{epoch_ms}-{n}-` prefix off paths of this shape to recover the
    // reporter's filename, so the digits are what the admin captions are
    // computed from. A mobile report's screenshot has to land in the same
    // place a web one does.
    expect(attachmentPath("u-123", 1758412800000, 2, "Scan-Report.PDF")).toBe(
      "u-123/1758412800000-2-scan-report.pdf",
    );
  });

  it("names the same bucket the web writes to", () => {
    expect(FEEDBACK_BUCKET).toBe("feedback-attachments");
  });

  it("holds the same limits the web holds", () => {
    expect(MAX_ATTACHMENTS).toBe(3);
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("acceptsAttachmentType", () => {
  it("accepts every type the bucket's MIME allow-list takes", () => {
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(acceptsAttachmentType(mime, "shot")).toBe(true);
    }
  });

  it("falls back to the extension when the MIME type is missing", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp"]) {
      expect(acceptsAttachmentType("", `shot.${ext}`)).toBe(true);
    }
    // A camera roll is not case sensitive.
    expect(acceptsAttachmentType("", "IMG_0042.PNG")).toBe(true);
  });

  it("rejects an image the picker can return but the bucket will not take", () => {
    expect(acceptsAttachmentType("image/heic", "photo.heic")).toBe(false);
  });
});

describe("attachmentIssue", () => {
  const base: PickedAttachment = {
    uri: "file:///tmp/shot.png",
    name: "shot.png",
    sizeBytes: 1024 * 1024,
    mimeType: "image/png",
  };

  it("accepts a file that clears all three guards", () => {
    expect(attachmentIssue(base, [])).toBeNull();
  });

  it("rejects a file over the per-file cap", () => {
    expect(attachmentIssue({ ...base, sizeBytes: MAX_ATTACHMENT_BYTES + 1 }, [])).toMatchObject({
      kind: "size",
      name: "shot.png",
    });
  });

  it("rejects a type the bucket does not take", () => {
    expect(attachmentIssue({ ...base, mimeType: "image/heic" }, [])).toMatchObject({
      kind: "type",
      name: "shot.png",
    });
  });

  it("rejects a duplicate within the same batch", () => {
    expect(attachmentIssue(base, [base])).toMatchObject({ kind: "duplicate", name: "shot.png" });
  });
});

describe("formatBytes", () => {
  it("reads the way the web's does", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2.5 * 1024)).toBe("2.5 KB");
    expect(formatBytes(12 * 1024)).toBe("12 KB");
    expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe("10 MB");
  });
});

describe("the phone attaches what it shows", () => {
  const screen = () =>
    readFileSync(join(process.cwd(), "apps/mobile/app/(app)/report-issue.tsx"), "utf8");

  it("offers the multi-image picker to a signed-in bug reporter", () => {
    expect(screen()).toContain("launchImageLibraryAsync");
    expect(screen()).toContain("allowsMultipleSelection: true");
    expect(screen()).toContain("selectionLimit: room");
  });

  it("uploads the picked screenshots before the report is inserted", () => {
    expect(screen()).toContain("uploadFeedbackAttachments(user.id, picked)");
    expect(screen()).toContain("attachments: attachmentPaths");
  });

  it("still sends the text when an upload fails", () => {
    expect(screen()).toContain("sending the rest");
  });

  it("applies the same guards the web applies, at pick time", () => {
    expect(screen()).toContain("attachmentIssue(candidate,");
    expect(screen()).toContain("MAX_ATTACHMENT_BYTES");
  });
});

describe("the two clients agree on the columns", () => {
  it("writes the same fields the web writes", () => {
    /*
     * Two clients writing one table with different column names is how the
     * `description` / `message` confusion happened. Read from the web source
     * rather than trusting that I copied it correctly.
     */
    const web = readFileSync(join(process.cwd(), "apps/web/src/lib/feedback.ts"), "utf8");
    const baseRow = web.slice(
      web.indexOf("function baseRow"),
      web.indexOf("function baseRow") + 900,
    );

    const webFields = new Set([...baseRow.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]));
    const mobileFields = new Set(
      Object.keys(
        feedbackRow({
          kind: "bug",
          description: "d",
          userId: null,
          email: null,
          screen: null,
          context,
        }),
      ),
    );

    expect(webFields.size).toBeGreaterThan(5);
    for (const field of webFields) {
      expect(mobileFields, `mobile is missing the web's "${field}" column`).toContain(field);
    }
  });
});

describe("an empty diagnostics section never reaches support", () => {
  /*
   * Found by sending a real report from the phone and reading the row back.
   * `issue_reports.description` came out as:
   *
   *   Testing the feedback path from the phone
   *
   *   --- Recent errors on this phone ---
   *   No errors recorded on this phone.
   *
   * with the attach switch showing "No" on screen. `errorsForSupport` answers
   * with that sentence rather than an empty string, which is right for the
   * preview and wrong for the body, so `appendErrorLog`'s `!log.trim()` guard
   * never fired. Every report from a healthy phone carried a diagnostics
   * heading with no diagnostics under it.
   */
  const screen = () =>
    readFileSync(join(process.cwd(), "apps/mobile/app/(app)/report-issue.tsx"), "utf8");

  it("sends on whether there are errors, not just on the switch", () => {
    const s = screen();
    expect(s).toContain("const attaching = attachLog && errorCount > 0;");
    expect(s).toContain("appendErrorLog(cleanDescription(message), log, attaching)");
  });

  it("never passes the bare switch to appendErrorLog", () => {
    // The exact call that shipped the empty section.
    expect(screen()).not.toMatch(/appendErrorLog\([^)]*,\s*attachLog\s*\)/);
  });

  it("the badge, the preview and the body read the same value", () => {
    /*
     * They disagreed once: the badge said "No" while the send path attached.
     * One name for one condition is what keeps them from drifting apart again.
     */
    expect(screen()).not.toMatch(/attachLog && errorCount > 0 \?/);
  });
});
