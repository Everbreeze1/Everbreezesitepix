import { describe, expect, it } from "vitest";
import { CONDITION_OPTIONS, answerWantsPhoto, formatChecklistAnswer } from "@everlumen/shared";
import {
  choicesFor,
  hasResponse,
  parseNumericAnswer,
  responsePatch,
  toggledResponse,
} from "../apps/mobile/src/api/checklist-answers";

/*
 * Checklist answers as stored by the mobile runner.
 *
 * These shapes are not a local decision. The same rows are rendered by the web
 * runner, the public share page, and the printed PDF, all of which format them
 * through `formatChecklistAnswer` in `@everlumen/shared`. The last block below
 * feeds this module's output straight into that formatter, which is the actual
 * contract: anything mobile writes has to come out as readable text on paper.
 */

describe("hasResponse", () => {
  it("treats null, undefined, and empty string as unanswered", () => {
    expect(hasResponse(null)).toBe(false);
    expect(hasResponse(undefined)).toBe(false);
    expect(hasResponse("")).toBe(false);
  });

  it("treats zero and false as answered", () => {
    // A numeric reading of 0 and a "No" are answers. Testing truthiness here is
    // the classic bug that silently discards them.
    expect(hasResponse(0)).toBe(true);
    expect(hasResponse(false)).toBe(true);
  });
});

describe("toggledResponse", () => {
  it("selects a new choice", () => {
    expect(toggledResponse("pass_fail", null, "Pass")).toBe("Pass");
    expect(toggledResponse("pass_fail", "Fail", "Pass")).toBe("Pass");
  });

  it("clears when the current choice is tapped again", () => {
    // The only way to undo an answer on a required item.
    expect(toggledResponse("pass_fail", "Pass", "Pass")).toBeNull();
    expect(toggledResponse("yes_no", "No", "No")).toBeNull();
  });

  it("compares ratings numerically", () => {
    expect(toggledResponse("rating", 3, 3)).toBeNull();
    expect(toggledResponse("rating", 3, 5)).toBe(5);
    // `response_value` is jsonb, so a rating can come back as a string from a
    // row written by some other client. Comparing without coercion would make
    // the star look selected and refuse to clear.
    expect(toggledResponse("rating", "3", 3)).toBeNull();
  });

  it("treats severity like rating: numeric, and tapping the selected step clears it", () => {
    expect(toggledResponse("severity", null, 4)).toBe(4);
    expect(toggledResponse("severity", 4, 5)).toBe(5);
    expect(toggledResponse("severity", 5, 5)).toBeNull();
    // Stored as jsonb, so a "5" written by another client must still clear.
    expect(toggledResponse("severity", "5", 5)).toBeNull();
  });

  it("toggles condition like the other pick-one types", () => {
    expect(toggledResponse("condition", null, "Fair")).toBe("Fair");
    expect(toggledResponse("condition", "Fair", "Poor")).toBe("Poor");
    expect(toggledResponse("condition", "Poor", "Poor")).toBeNull();
  });
});

describe("choicesFor", () => {
  it("matches the labels web renders", () => {
    expect(choicesFor("pass_fail")).toEqual(["Pass", "Fail"]);
    expect(choicesFor("yes_no")).toEqual(["Yes", "No"]);
  });

  it("offers Good, Fair and Poor for condition, in the shared order", () => {
    // Written out in the import-free module, so pinned to the shared list here.
    expect(choicesFor("condition")).toEqual(["Good", "Fair", "Poor"]);
    expect(choicesFor("condition")).toEqual([...CONDITION_OPTIONS]);
  });

  it("returns null for types that are not pick-one", () => {
    expect(choicesFor("rating")).toBeNull();
    expect(choicesFor("text")).toBeNull();
    expect(choicesFor("numeric")).toBeNull();
    expect(choicesFor("checkbox")).toBeNull();
    expect(choicesFor("severity")).toBeNull();
  });
});

describe("responsePatch", () => {
  const now = () => new Date("2026-03-14T09:41:07.000Z");

  it("completes the item when an answer is recorded", () => {
    /*
     * Progress counts read `completed_at`, not `response_value`. Writing the
     * answer alone leaves a checklist that looks answered on screen and still
     * reports as unfinished everywhere else.
     */
    const patch = responsePatch("Pass", "user-1", now);
    expect(patch.response_value).toBe("Pass");
    expect(patch.completed_at).toBe("2026-03-14T09:41:07.000Z");
    expect(patch.completed_by).toBe("user-1");
  });

  it("un-completes the item when the answer is cleared", () => {
    const patch = responsePatch(null, "user-1", now);
    expect(patch.response_value).toBeNull();
    expect(patch.completed_at).toBeNull();
    expect(patch.completed_by).toBeNull();
  });

  it("completes on a zero reading", () => {
    const patch = responsePatch(0, "user-1", now);
    expect(patch.completed_at).not.toBeNull();
  });
});

describe("parseNumericAnswer", () => {
  it("accepts numbers, including zero and negatives", () => {
    expect(parseNumericAnswer("12")).toBe(12);
    expect(parseNumericAnswer("0")).toBe(0);
    expect(parseNumericAnswer("-3.5")).toBe(-3.5);
    expect(parseNumericAnswer("  7  ")).toBe(7);
  });

  it("refuses anything that is not a number", () => {
    // Storing "12a" as text produces a report nobody can total, and it looks
    // fine on screen until someone tries.
    expect(parseNumericAnswer("12a")).toBeNull();
    expect(parseNumericAnswer("abc")).toBeNull();
    expect(parseNumericAnswer("")).toBeNull();
  });
});

describe("what mobile stores prints correctly", () => {
  /*
   * The real contract. Each value below is produced by this module and then
   * formatted by the shared renderer the PDF and share page use.
   */
  it.each([
    ["pass_fail", "Pass", "Pass"],
    ["yes_no", "No", "No"],
    ["rating", 4, "4 / 5"],
    ["numeric", 12.5, "12.5"],
    ["text", "Sealed and signed off", "Sealed and signed off"],
    ["severity", 5, "5 / 5 Critical"],
    ["condition", "Poor", "Poor"],
  ])("%s answers render as %s", (itemType, stored, expected) => {
    const patch = responsePatch(stored, "user-1");
    expect(formatChecklistAnswer(itemType, patch.response_value)).toBe(expected);
  });

  it("a numeric answer prints with its unit", () => {
    const patch = responsePatch(parseNumericAnswer("42"), "user-1");
    expect(formatChecklistAnswer("numeric", patch.response_value, "psi")).toBe("42 psi");
    expect(formatChecklistAnswer("numeric", patch.response_value, "  ")).toBe("42");
  });

  it("a severity picked through a toggle prints its label", () => {
    const value = toggledResponse("severity", null, 3);
    expect(formatChecklistAnswer("severity", responsePatch(value, "u").response_value)).toBe(
      "3 / 5 Moderate",
    );
  });

  it("a cleared answer prints as nothing rather than the word null", () => {
    const patch = responsePatch(null, "user-1");
    expect(formatChecklistAnswer("text", patch.response_value)).toBeNull();
  });

  it("a zero reading prints as 0, not as blank", () => {
    const patch = responsePatch(0, "user-1");
    expect(formatChecklistAnswer("numeric", patch.response_value)).toBe("0");
  });
});

describe("which answers prompt for a photo", () => {
  /*
   * The runner offers the camera right after one of these is chosen. Fed the
   * values this module stores, so a change to either side shows up here.
   */
  it("prompts on Fail, Poor and a High or Critical severity", () => {
    expect(answerWantsPhoto("pass_fail", toggledResponse("pass_fail", null, "Fail"))).toBe(true);
    expect(answerWantsPhoto("condition", toggledResponse("condition", null, "Poor"))).toBe(true);
    expect(answerWantsPhoto("severity", toggledResponse("severity", null, 4))).toBe(true);
    expect(answerWantsPhoto("severity", toggledResponse("severity", null, 5))).toBe(true);
  });

  it("does not prompt on a good answer, a low severity, or a cleared one", () => {
    expect(answerWantsPhoto("pass_fail", "Pass")).toBe(false);
    expect(answerWantsPhoto("condition", "Fair")).toBe(false);
    expect(answerWantsPhoto("severity", 3)).toBe(false);
    expect(answerWantsPhoto("severity", toggledResponse("severity", 4, 4))).toBe(false);
  });
});
