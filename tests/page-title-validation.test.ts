import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  createProjectPageInputSchema,
  updateProjectPageInputSchema,
} from "../apps/api/src/domains/projects/pages";
import { validationMessage } from "../apps/api/src/lib/errors";

/*
 * Renaming a document on a phone means tapping the title box, clearing it, then
 * waiting for the on-screen keyboard - the field sits empty for well over the
 * editor's 800ms autosave debounce. The editor used to send that empty string
 * as `title`, which failed `min(1)` and rejected the entire write, so the body
 * typed in the same window was dropped too and the user got the raw Zod issue
 * array in a red toast.
 *
 * These lock in both halves: the schema still refuses a blank title (the field
 * is genuinely NOT NULL), and an omitted title is the supported way to save
 * everything else while a rename is in progress.
 */
describe("project page title validation", () => {
  it("rejects a blank title - the client must omit it, not send ''", () => {
    const res = updateProjectPageInputSchema.safeParse({
      pageId: "11111111-1111-4111-8111-111111111111",
      title: "",
      contentHtml: "<p>work typed while the box was empty</p>",
    });
    expect(res.success).toBe(false);
  });

  it("rejects a whitespace-only title", () => {
    const res = updateProjectPageInputSchema.safeParse({
      pageId: "11111111-1111-4111-8111-111111111111",
      title: "   ",
    });
    expect(res.success).toBe(false);
  });

  it("accepts an omitted title so the body still saves mid-rename", () => {
    const res = updateProjectPageInputSchema.safeParse({
      pageId: "11111111-1111-4111-8111-111111111111",
      title: undefined,
      contentHtml: "<p>work typed while the box was empty</p>",
    });
    expect(res.success).toBe(true);
    // `updateProjectPageService` patches `title` only when it is not undefined,
    // so this leaves the stored title untouched instead of blanking it.
    expect(res.success && res.data.title).toBeUndefined();
  });

  it("trims a real title rather than storing the user's stray spaces", () => {
    const res = updateProjectPageInputSchema.safeParse({
      pageId: "11111111-1111-4111-8111-111111111111",
      title: "  Roof inspection  ",
    });
    expect(res.success && res.data.title).toBe("Roof inspection");
  });

  it("applies the same rules on create", () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    expect(createProjectPageInputSchema.safeParse({ projectId, title: "" }).success).toBe(false);
    expect(createProjectPageInputSchema.safeParse({ projectId }).success).toBe(true);
  });
});

/*
 * The web client renders an error response's `message` straight into a toast.
 * `ZodError.message` is `JSON.stringify(issues, null, 2)`, so forwarding it put
 * `[ { "code": "too_small", "minimum": 1, … "path": [ "title" ] } ]` in front of
 * a user standing on a job site.
 */
describe("validationMessage - no raw Zod JSON reaches a toast", () => {
  function errorFor(input: unknown): ZodError {
    const res = updateProjectPageInputSchema.safeParse(input);
    if (res.success) throw new Error("expected the input to fail validation");
    return res.error;
  }

  it("turns an empty title into a sentence a person can act on", () => {
    const msg = validationMessage(
      errorFor({ pageId: "11111111-1111-4111-8111-111111111111", title: "" }),
    );
    expect(msg).toBe("Title can't be empty");
  });

  it("never emits JSON, brackets, or Zod issue codes", () => {
    for (const input of [
      { pageId: "11111111-1111-4111-8111-111111111111", title: "" },
      { pageId: "11111111-1111-4111-8111-111111111111", title: "x".repeat(500) },
      { pageId: "not-a-uuid" },
      {},
    ]) {
      const msg = validationMessage(errorFor(input));
      expect(msg).not.toContain("{");
      expect(msg).not.toContain("[");
      expect(msg).not.toContain("too_small");
      expect(msg).not.toContain('"code"');
      expect(msg).not.toContain("\n");
      expect(msg.length).toBeLessThan(120);
    }
  });

  it("reports an over-long title with its limit", () => {
    const msg = validationMessage(
      errorFor({ pageId: "11111111-1111-4111-8111-111111111111", title: "x".repeat(500) }),
    );
    expect(msg).toBe("Title is too long (max 200 characters)");
  });

  it("falls back to a generic line for fields with no user-facing label", () => {
    const msg = validationMessage(errorFor({ pageId: "not-a-uuid" }));
    expect(msg).toBe("Some of the information sent was invalid");
  });
});
