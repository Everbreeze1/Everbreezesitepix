import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SRC = readFileSync(
  join(ROOT, "apps/web/src/features/projects/components/ProjectTasks.tsx"),
  "utf8",
);

/** Code only. The fixes below quote the broken behaviour in the comments that explain them. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The second round of review, after the bulk bar shipped:
 *
 *   "i click drop down to choose assigned to. then after i click that it
 *    doesn't show who its assigned to. which i click that drop down should have
 *    a little hint of who has been assigned the task. after picking assignee
 *    the drop down window disappears, doesnt allow me to put date or priority,
 *    i have to click back at it. Also there is a list view and a table view,
 *    the table view is not showing the task assignment flow."
 *
 * Three complaints, one bar, three separate mistakes in it. Each is pinned
 * here because each was a deliberate choice that read as a bug in use, and a
 * later refactor would make every one of them again without being told.
 */

describe("the bulk bar says what the selection currently is", () => {
  /*
   * The triggers were hardcoded labels over `value=""`, so they could not show
   * an assignee even in principle. A control that has to be opened to reveal
   * what it is about to change is a control that gets used wrong.
   */
  it("derives the selection's shared value per field", () => {
    expect(CODE).toContain("const sharedValue =");
    expect(CODE).toContain("const selectionAssignee =");
    expect(CODE).toContain("const selectionPriority =");
    expect(CODE).toContain("const selectionDue =");
  });

  it("binds the assignee and priority selects to it instead of to a blank", () => {
    // The exact shape of the bug: a Select whose value is the empty string can
    // never render the current state.
    expect(CODE).not.toMatch(/<Select\s+value=""/);
    expect(CODE).toContain("selectionAssigneeLabel");
    expect(CODE).toContain('selectionPriority === "mixed"');
  });

  it("says 'Mixed' rather than pretending a disagreeing batch is unassigned", () => {
    // Showing three differently-assigned tasks as "Unassigned" would cost
    // somebody an accidental reassignment.
    expect(CODE).toContain('"__mixed__"');
    expect(CODE).toContain("Mixed");
  });

  it("shows the assignee's avatar and their cannot-sign-in warning on the trigger", () => {
    expect(CODE).toContain("selectionAssigneeMember");
    expect(CODE).toMatch(/selectionAssigneeMember\?\.emailConfirmed === false/);
  });

  it("re-mounts the date input when the batch's date changes", () => {
    // An uncontrolled date input keeps whatever the browser last put in it, so
    // without this it would go on showing the previous batch's date.
    expect(CODE).toContain("key={String(selectionDue)}");
  });
});

describe("the bulk bar survives its own actions", () => {
  /*
   * "after picking assignee the drop down window disappears, doesnt allow me to
   *  put date or priority, i have to click back at it"
   *
   * `bulkPatch` called `clearSelection()` on success, which unmounted the bar.
   * Assigning is usually the FIRST of three things somebody does to a batch.
   */
  it("bulkPatch does not clear the selection", () => {
    const fn = CODE.slice(CODE.indexOf("const bulkPatch ="), CODE.indexOf("const bulkAssign ="));
    expect(fn).toContain("await load()");
    expect(fn).not.toContain("clearSelection()");
  });

  it("bulkComplete does not clear the selection either", () => {
    const fn = CODE.slice(CODE.indexOf("const bulkComplete ="), CODE.indexOf("const bulkDelete ="));
    expect(fn).not.toContain("clearSelection()");
  });

  it("bulkDelete DOES clear it - those rows no longer exist", () => {
    const fn = CODE.slice(CODE.indexOf("const bulkDelete ="), CODE.indexOf("const removeTask ="));
    expect(fn).toContain("clearSelection()");
  });

  it("offers a way out that is not hunting for a button", () => {
    expect(CODE).toContain('e.key !== "Escape"');
  });

  /*
   * The cost of keeping the selection: a task closed under an "Open" filter
   * leaves the screen while staying ticked, and the next press of Delete would
   * reach a row the user can no longer see.
   */
  it("prunes the selection to what is actually on screen", () => {
    expect(CODE).toContain("const onScreen = new Set(visible.map((t) => t.id))");
    // Returning `prev` unchanged is what stops the effect re-rendering itself.
    expect(CODE).toContain("return next.size === prev.size ? prev : next");
  });
});

describe("the dialog never says Unassigned about an assigned task", () => {
  /*
   * Radix renders the placeholder when no SelectItem matches the bound value,
   * so a task held by somebody outside the loaded roster read as
   * "Unassigned" - the field saying the opposite of the truth about who owns
   * the work. The roster still loading, an assignee who has left the team, and
   * a task assigned from the photo panel all produce it.
   */
  it("offers the current holder even when the roster does not contain them", () => {
    expect(CODE).toContain("const assigneeOptions = useMemo");
    expect(CODE).toContain("members.some((m) => m.user_id === assigneeUserId)");
    // Bound to the widened list, not to the raw roster.
    expect(CODE).toContain("{assigneeOptions.map((m) => (");
    expect(CODE).not.toContain("{members.length > 0 ? (");
  });

  it("does not accuse an unknown account of being unconfirmed", () => {
    // null is "we do not know", which must never render as a warning.
    const fn = CODE.slice(
      CODE.indexOf("const assigneeOptions = useMemo"),
      CODE.indexOf("const selectedMember ="),
    );
    expect(fn).toContain("emailConfirmed: null");
  });
});

describe("both views carry the assignment flow", () => {
  /*
   * "there is a list view and a table view, the table view is not showing the
   *  task assignment flow."
   */
  it("the bar is not gated on the list view", () => {
    expect(CODE).not.toContain('view === "list" && selected.size > 0');
    expect(CODE).toContain("{selected.size > 0 && (");
  });

  it("board cards can be selected too", () => {
    const card = CODE.slice(
      CODE.indexOf("const renderBoardCard ="),
      CODE.indexOf('return (\n    <div className="mt-9">'),
    );
    expect(card).toContain("<Checkbox");
    expect(card).toContain("toggleSelected(t.id)");
  });

  it("a board card warns about an assignee who cannot sign in, same as a row", () => {
    const fn = CODE.slice(
      CODE.indexOf("const renderAssignee ="),
      CODE.indexOf("const toggleExpanded ="),
    );
    expect(fn).toContain("emailConfirmed === false");
  });
});
