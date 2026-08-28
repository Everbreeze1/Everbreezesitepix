import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEEDBACK_BUCKET,
  attachmentKind,
  attachmentName,
  indexSignedUrls,
} from "../apps/api/src/domains/admin/feedback";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Screenshots on a feedback report.
 *
 * Reported by the user: "when I attach a picture or a screenshot as attachment
 * it doesn't show up in the Admin Feedback list". Two separate absences, and
 * either one alone was enough to produce that symptom.
 *
 * The first is the plain one: the console never rendered `report.attachments`.
 * The paths were selected, mapped, typed and shipped all the way to the browser
 * and then dropped, so a report filed with a picture of the bug was
 * indistinguishable from one filed without.
 *
 * The second would have defeated the obvious fix. The bucket is private and its
 * only read policy scopes an object to the folder of the account that uploaded
 * it (20260921000000), so the path on the row is readable by exactly one person
 * - the reporter - and not by the admin triaging it. Rendering the path, or any
 * URL the browser could build from it, would have produced a broken image
 * instead of a missing one. They have to be signed with the service role.
 */

describe("naming an attachment", () => {
  it("recovers the reporter's filename from the upload path", () => {
    // The shape uploadFeedbackAttachments writes: {auth_uid}/{epoch_ms}-{n}-{name}.
    expect(
      attachmentName("9f2c8a1e-0000-4000-8000-000000000000/1758412800000-0-screenshot.png"),
    ).toBe("screenshot.png");
    expect(attachmentName("uid/1758412800000-2-scan-of-the-error.pdf")).toBe(
      "scan-of-the-error.pdf",
    );
  });

  it("leaves a path that carries no upload prefix alone", () => {
    // Anything written by something other than the current uploader still has
    // to get a caption. An empty one reads as a rendering failure.
    expect(attachmentName("uid/screenshot.png")).toBe("screenshot.png");
    expect(attachmentName("screenshot.png")).toBe("screenshot.png");
  });

  it("never leaves a caption empty", () => {
    // A name that is nothing but the stripped prefix would otherwise render as
    // a blank chip with no way to tell which file it was.
    expect(attachmentName("uid/1758412800000-0-")).toBe("1758412800000-0-");
  });

  it("does not mistake a digit run inside a filename for the prefix", () => {
    // The prefix is anchored and needs both halves. "2024-01-report.pdf" is a
    // filename, not a timestamp and an index.
    expect(attachmentName("uid/2024-01-report.pdf")).toBe("2024-01-report.pdf");
  });
});

describe("deciding how to show an attachment", () => {
  it("shows every image type the picker accepts inline", () => {
    // ATTACHMENT_ACCEPT in apps/web/src/lib/feedback.ts. A type the reporter
    // can pick but the console will not render is a silent downgrade to a link.
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp"]) {
      expect(attachmentKind(`uid/1758412800000-0-shot.${ext}`), ext).toBe("image");
    }
  });

  it("is case insensitive, because a camera roll is not", () => {
    expect(attachmentKind("uid/1758412800000-0-IMG_0042.PNG")).toBe("image");
    expect(attachmentKind("uid/1758412800000-0-Scan.PDF")).toBe("pdf");
  });

  it("links a PDF instead of trying to render it", () => {
    expect(attachmentKind("uid/1758412800000-0-invoice.pdf")).toBe("pdf");
  });

  it("falls back to a link for anything else", () => {
    expect(attachmentKind("uid/1758412800000-0-log.txt")).toBe("file");
    expect(attachmentKind("uid/1758412800000-0-noextension")).toBe("file");
  });
});

describe("matching signed URLs back to the right report", () => {
  const A = "user-a/1758412800000-0-a.png";
  const B = "user-b/1758412800001-0-b.png";
  const C = "user-c/1758412800002-0-c.png";

  it("maps each URL onto the path it belongs to", () => {
    expect(
      indexSignedUrls(
        [
          { path: A, signedUrl: "https://x/a?token=1" },
          { path: B, signedUrl: "https://x/b?token=2" },
        ],
        [A, B],
      ),
    ).toEqual({ [A]: "https://x/a?token=1", [B]: "https://x/b?token=2" });
  });

  it("does not hand one customer's screenshot to another customer's report", () => {
    /*
     * The failure this function exists to prevent, and the reason it is keyed
     * by path rather than by position.
     *
     * A page of reports belongs to many different people, so their screenshots
     * live in different folders and get signed together. If storage answers
     * with the middle entry dropped, index-based mapping slides B's URL onto
     * A and C's onto B - every report after the gap showing the NEXT report's
     * screen, under a filename that looks exactly right. Silent, and far worse
     * than the blank the whole change is fixing.
     */
    const out = indexSignedUrls(
      [
        { path: B, signedUrl: "https://x/b?token=2" },
        { path: C, signedUrl: "https://x/c?token=3" },
      ],
      [A, B, C],
    );
    expect(out[B]).toBe("https://x/b?token=2");
    expect(out[C]).toBe("https://x/c?token=3");
    // And crucially, the one that never came back gets nothing at all.
    expect(out[A]).toBeUndefined();
  });

  it("survives storage answering out of order", () => {
    const out = indexSignedUrls(
      [
        { path: C, signedUrl: "https://x/c?token=3" },
        { path: A, signedUrl: "https://x/a?token=1" },
      ],
      [A, C],
    );
    expect(out).toEqual({ [A]: "https://x/a?token=1", [C]: "https://x/c?token=3" });
  });

  it("omits an entry that failed to sign rather than inventing a URL", () => {
    // A null url is what makes the console say "unavailable" next to the
    // filename instead of rendering a broken image.
    const out = indexSignedUrls([{ path: A, signedUrl: null, error: "Object not found" }], [A]);
    expect(out).toEqual({});
  });

  it("falls back to position only when an entry carries no path", () => {
    expect(indexSignedUrls([{ signedUrl: "https://x/a?token=1" }], [A])).toEqual({
      [A]: "https://x/a?token=1",
    });
  });

  it("copes with an empty or missing response", () => {
    expect(indexSignedUrls([], [A])).toEqual({});
    expect(indexSignedUrls(null, [A])).toEqual({});
    expect(indexSignedUrls(undefined, [A])).toEqual({});
  });
});

describe("the admin console can actually open one", () => {
  it("signs attachment paths with the service role", () => {
    const src = read("apps/api/src/domains/admin/feedback.ts");
    // Signed server side or not at all: the bucket is private, and its read
    // policy is the reporter's own folder.
    expect(src).toContain("createSignedUrls");
    expect(src).toContain("FEEDBACK_BUCKET");
    // Batched. The singular call would cost one round trip per screenshot on a
    // page of fifty reports.
    expect(src).not.toContain("createSignedUrl(");
  });

  it("names the same bucket the uploader writes to", () => {
    const lib = read("apps/web/src/lib/feedback.ts");
    expect(lib).toContain(`export const FEEDBACK_BUCKET = "${FEEDBACK_BUCKET}"`);
    // And the bucket the migration creates, or every link would be unsigned.
    expect(read("supabase/migrations/20260921000000_feedback_report_context.sql")).toContain(
      `'${FEEDBACK_BUCKET}'`,
    );
  });

  it("hands the console a URL rather than a path", () => {
    const api = read("apps/api/src/domains/admin/feedback.ts");
    expect(api).toContain("export interface FeedbackAttachment");
    // The web mirror has to move with it, or the console renders `[object Object]`.
    const web = read("apps/web/src/lib/admin.functions.ts");
    expect(web).toContain("export interface FeedbackAttachment");
    expect(web).toContain("attachments: FeedbackAttachment[]");
  });

  it("renders them on the card, which is the whole bug", () => {
    const page = read("apps/web/src/features/admin/pages/AdminFeedbackPage.tsx");
    expect(page).toContain("AttachmentStrip");
    expect(page).toContain("attachments={report.attachments");
    // An image is shown, not just linked. Glancing at the screenshot while
    // reading the description is the entire point of collecting it.
    expect(page).toContain("<img");
  });

  it("says which file it was when the link could not be signed", () => {
    // A missing object or an uncreated bucket must not render as a broken
    // image, which is indistinguishable from the bug this fixes.
    const page = read("apps/web/src/features/admin/pages/AdminFeedbackPage.tsx");
    expect(page).toContain("unavailable");
  });

  it("never lets a signing failure take down the queue", () => {
    const src = read("apps/api/src/domains/admin/feedback.ts");
    const signer = src.slice(src.indexOf("async function signFeedbackAttachments"));
    const body = signer.slice(0, signer.indexOf("\nexport const listFeedbackInputSchema"));
    // The whole feedback list would otherwise fail on one deleted screenshot.
    expect(body).toContain("try {");
    expect(body).toContain("catch");
    expect(body).not.toContain("throw ");
  });
});
