import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  photoCommentDeleteErrorMessage,
  photoCommentErrorMessage,
} from "../packages/shared/src/photo-comment-errors";

/*
 * Found on the phone, not in a type or a test.
 *
 * Posting a comment showed this in red under the composer:
 *
 *     new row violates row-level security policy for table "photo_comments"
 *
 * `createPhotoCommentService` did `throw new Error(error.message)`, so
 * Postgres's own words travelled over `/v1/rpc` and onto the screen. Nothing
 * caught it: the shape was right, the op was registered, tsc was clean, and the
 * accessibility tree showed only "Post comment", because the message rendered
 * in a Text node the dump did not surface. It took a screenshot to see it.
 */

describe("what a refused comment says", () => {
  it("names the access problem instead of the table", () => {
    const message = photoCommentErrorMessage({
      code: "42501",
      message: 'new row violates row-level security policy for table "photo_comments"',
    });
    expect(message).toContain("do not have access");
    expect(message).not.toContain("photo_comments");
    expect(message).not.toContain("row-level security");
  });

  it("never passes an unrecognised refusal through", () => {
    /*
     * The allow-list is the whole point, and the reason is written out in
     * `taskPhotoItemErrorMessage`: filtering on what *looks* like Postgres
     * internals leaks by default, because no list of its phrasings is ever
     * finished. An unknown code gets a plain sentence.
     */
    const message = photoCommentErrorMessage({
      code: "22P02",
      message: 'invalid input syntax for type uuid: "nope"',
    });
    expect(message).not.toContain("uuid");
    expect(message).not.toContain("nope");
    expect(message).toBe("Could not post that comment. Try again in a moment.");
  });

  it("copes with no error object at all", () => {
    expect(photoCommentErrorMessage(null)).toBeTruthy();
    expect(photoCommentErrorMessage(undefined)).toBeTruthy();
    expect(photoCommentErrorMessage({})).toBeTruthy();
  });

  it("says whose comment it is when a delete is refused", () => {
    expect(photoCommentDeleteErrorMessage({ code: "42501" })).toContain("comments you wrote");
    expect(photoCommentDeleteErrorMessage({ code: "42501" })).not.toContain("policy");
  });
});

describe("the service uses it", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/photos/comments.ts"), "utf8");

  it("no comment write throws a raw database message", () => {
    /*
     * Checked as text because this is the exact line that shipped, and it is
     * one keystroke away from coming back:
     *
     *     if (error) throw new Error(error.message);
     */
    const s = service();
    expect(s).not.toMatch(/throw new Error\(error\.message\)/);
    expect(s).toContain("photoCommentErrorMessage(error)");
    expect(s).toContain("photoCommentDeleteErrorMessage(error)");
    // The read path too. It was the one I missed, and this assertion is what
    // found it: a refused list would have leaked the same way.
    expect(s).toContain("photoCommentListErrorMessage(error)");
  });
});
