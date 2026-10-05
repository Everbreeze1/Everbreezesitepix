import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canAuthorRecords,
  canDeleteTask,
  canReopenRecord,
  checklistDeleteMessage,
  isManagerRole,
  MAX_PASTED_ITEMS,
  parsePastedItems,
  reopenChecklistPatch,
  checklistCompletedMessage,
  checklistCompletionBlock,
  checklistSnapshot,
  completionRights,
  addCounts,
  missingPhotoCount,
  overrideConfirm,
  pendingAnswerWrites,
  photoCountsOf,
  queuedItemPhotoCounts,
  recordPrintLinks,
  requiredOpenCount,
  workflowCompletedMessage,
  workflowDeleteMessage,
  workflowReadiness,
} from "../apps/mobile/src/api/record-edit-rules";

/*
 * Editing tasks, checklists and workflows on the phone, with the web's rules.
 *
 * The database is the boundary; these decide which buttons are drawn. A button
 * the server will ignore (a task delete RLS filters to nothing) is the failure
 * each rule exists to prevent.
 */

const MOBILE = join(process.cwd(), "apps/mobile");
const read = (rel: string) => readFileSync(join(MOBILE, rel), "utf8");

describe("canAuthorRecords mirrors useTemplateAuthoringAccess", () => {
  const team = (over: Partial<Parameters<typeof canAuthorRecords>[0] & object> = {}) => ({
    myRole: "owner",
    plan: "pro",
    isActive: true,
    isInternal: false,
    ...over,
  });

  it("allows owners, admins and managers on an active Pro or Team plan", () => {
    for (const myRole of ["owner", "admin", "manager"]) {
      expect(canAuthorRecords(team({ myRole }))).toBe(true);
      expect(canAuthorRecords(team({ myRole, plan: "team" }))).toBe(true);
    }
  });

  it("treats a missing role as the solo owner", () => {
    expect(canAuthorRecords(team({ myRole: null }))).toBe(true);
  });

  it("refuses crew roles, Starter, lapsed plans, and not knowing yet", () => {
    expect(canAuthorRecords(team({ myRole: "standard" }))).toBe(false);
    expect(canAuthorRecords(team({ myRole: "restricted" }))).toBe(false);
    expect(canAuthorRecords(team({ plan: "starter" }))).toBe(false);
    expect(canAuthorRecords(team({ isActive: false }))).toBe(false);
    expect(canAuthorRecords(undefined)).toBe(false);
    expect(canAuthorRecords(null)).toBe(false);
  });

  it("counts an internal workspace as Team whatever its plan column says", () => {
    expect(canAuthorRecords(team({ plan: "starter", isInternal: true }))).toBe(true);
  });
});

describe("reopen and manager rules mirror lib/assignment.ts", () => {
  const none = { assignedTo: null, assignedBy: null, createdBy: null, completedBy: null };

  it("managers are owner and admin only", () => {
    expect(isManagerRole("owner")).toBe(true);
    expect(isManagerRole("admin")).toBe(true);
    expect(isManagerRole("manager")).toBe(false);
    expect(isManagerRole(null)).toBe(false);
  });

  it("anyone in the loop may reopen, a bystander may not", () => {
    const me = { userId: "u1", isManager: false };
    expect(canReopenRecord({ ...none, assignedTo: "u1" }, me)).toBe(true);
    expect(canReopenRecord({ ...none, assignedBy: "u1" }, me)).toBe(true);
    expect(canReopenRecord({ ...none, createdBy: "u1" }, me)).toBe(true);
    expect(canReopenRecord({ ...none, completedBy: "u1" }, me)).toBe(true);
    expect(canReopenRecord({ ...none, createdBy: "u2" }, me)).toBe(false);
    expect(canReopenRecord(none, { userId: "u1", isManager: true })).toBe(true);
    expect(canReopenRecord(none, { userId: null, isManager: true })).toBe(false);
  });

  it("clears all three sealing columns together", () => {
    expect(reopenChecklistPatch()).toEqual({
      completed_at: null,
      completed_by: null,
      snapshot: null,
    });
  });
});

describe("canDeleteTask follows the RLS delete policy", () => {
  it("offers delete to the creator only", () => {
    expect(canDeleteTask({ created_by: "u1" }, "u1")).toBe(true);
    expect(canDeleteTask({ created_by: "u2" }, "u1")).toBe(false);
    expect(canDeleteTask({}, "u1")).toBe(false);
    expect(canDeleteTask({ created_by: "u1" }, null)).toBe(false);
    expect(canDeleteTask(null, "u1")).toBe(false);
  });
});

describe("parsePastedItems matches the web bulk-add dialog", () => {
  it("splits lines and drops blanks", () => {
    expect(parsePastedItems("One\r\n\n  Two  \n\nThree").labels).toEqual(["One", "Two", "Three"]);
  });

  it("strips bullets and numbering", () => {
    const raw = ["- a", "* b", "\u2022 c", "\u2013 d", "\u2014 e", "1. f", "2) g"].join("\n");
    expect(parsePastedItems(raw).labels).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("keeps a hyphen that is part of the label", () => {
    expect(parsePastedItems("-10 degree check\nT-junction sealed").labels).toEqual([
      "-10 degree check",
      "T-junction sealed",
    ]);
  });

  it("caps a huge paste and says so", () => {
    const raw = Array.from({ length: MAX_PASTED_ITEMS + 5 }, (_, i) => `Item ${i}`).join("\n");
    const result = parsePastedItems(raw);
    expect(result.labels).toHaveLength(MAX_PASTED_ITEMS);
    expect(result.truncated).toBe(true);
    expect(parsePastedItems("a\nb").truncated).toBe(false);
  });
});

describe("delete confirmations name what is lost", () => {
  it("checklist", () => {
    expect(checklistDeleteMessage("Rough-in", 1)).toContain('"Rough-in" and its 1 item ');
    expect(checklistDeleteMessage("Rough-in", 3)).toContain("3 items");
  });

  it("workflow, with sign-offs only when there are some", () => {
    expect(workflowDeleteMessage("Install", { phases: 2, steps: 9, signoffs: 0 })).toContain(
      "(2 phases, 9 steps)",
    );
    expect(workflowDeleteMessage("Install", { phases: 1, steps: 1, signoffs: 1 })).toContain(
      "(1 phase, 1 step, 1 sign-off)",
    );
  });
});

describe("recordPrintLinks", () => {
  const base = {
    kind: "workflows" as const,
    webOrigin: "https://app.example.com/",
    projectId: "p1",
    recordId: "w1",
    shareToken: "tok",
    revokedAt: null as string | null,
  };

  it("uses the public print sheet while the link is live", () => {
    expect(recordPrintLinks(base)).toEqual({
      publicUrl: "https://app.example.com/share/workflows/tok",
      webUrl: "https://app.example.com/projects/p1/workflows/w1",
    });
  });

  it("builds the checklist routes the web serves", () => {
    expect(recordPrintLinks({ ...base, kind: "checklists", recordId: "c1" })).toEqual({
      publicUrl: "https://app.example.com/share/checklists/tok",
      webUrl: "https://app.example.com/projects/p1/checklists/c1",
    });
  });

  it("never hands out a revoked link", () => {
    expect(recordPrintLinks({ ...base, revokedAt: "2026-01-01" }).publicUrl).toBeNull();
  });

  it("builds nothing without a web origin", () => {
    expect(recordPrintLinks({ ...base, webOrigin: "" })).toEqual({
      publicUrl: null,
      webUrl: null,
    });
  });
});

describe("completionRights mirrors lib/assignment.ts", () => {
  const me = { userId: "me", isManager: false };

  it("unassigned or mine: close it, no override", () => {
    expect(completionRights({ assignedTo: null, assignedBy: null }, me)).toEqual({
      canComplete: true,
      isOverride: false,
      reason: null,
    });
    expect(completionRights({ assignedTo: "me", assignedBy: "boss" }, me).isOverride).toBe(false);
  });

  it("the assigner or a manager closes someone else's as an override", () => {
    const byAssigner = completionRights({ assignedTo: "sam", assignedBy: "me" }, me, "Sam");
    expect(byAssigner).toMatchObject({ canComplete: true, isOverride: true });
    expect(byAssigner.reason).toBe(
      "Assigned to Sam - completing it will record you as the one who closed it.",
    );
    expect(
      completionRights({ assignedTo: "sam", assignedBy: "x" }, { userId: "me", isManager: true })
        .isOverride,
    ).toBe(true);
  });

  it("a bystander may not, and is told who can", () => {
    const rights = completionRights({ assignedTo: "sam", assignedBy: "x" }, me, "");
    expect(rights.canComplete).toBe(false);
    expect(rights.reason).toBe(
      "Only the assignee can mark this complete. Ask a manager if it needs closing without them.",
    );
    expect(
      completionRights({ assignedTo: null, assignedBy: null }, { userId: null, isManager: true })
        .canComplete,
    ).toBe(false);
  });

  it("overrideConfirm names the record and the person", () => {
    const copy = overrideConfirm({ what: "Rough-in", who: "Sam", detail: "Extra." });
    expect(copy.title).toBe("Complete this for Sam?");
    expect(copy.description).toContain("you closed it, not Sam. Extra.");
    expect(copy.confirmText).toBe("Complete anyway");
  });
});

describe("checklist completion", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    id: "i1",
    label: "Panel",
    required: false,
    item_type: "pass_fail",
    description: null,
    completed_at: "2026-01-01T00:00:00Z",
    response_value: "Pass",
    notes: "ok",
    position: 0,
    ...over,
  });

  it("blocks an empty checklist and open required items", () => {
    expect(checklistCompletionBlock([])).toMatch(/Add items/);
    const open = [item({ required: true, completed_at: null }), item({ id: "i2" })];
    expect(requiredOpenCount(open)).toBe(1);
    expect(checklistCompletionBlock(open)).toBe("1 required item still open");
    expect(checklistCompletionBlock([item({ required: true })])).toBeNull();
  });

  it("seals the answers in the web's snapshot shape, in position order", () => {
    const snapshot = checklistSnapshot(
      "Rough-in",
      "2026-02-02T00:00:00Z",
      [item({ id: "b", position: 1, label: "B" }), item({ id: "a", position: 0, label: "A" })],
      new Map([["a", ["p1", "p2"]]]),
    );
    expect(snapshot.name).toBe("Rough-in");
    expect(snapshot.completed_at).toBe("2026-02-02T00:00:00Z");
    expect(snapshot.items.map((row) => row.label)).toEqual(["A", "B"]);
    expect(snapshot.items[0]).toEqual({
      label: "A",
      required: false,
      item_type: "pass_fail",
      description: null,
      completed_at: "2026-01-01T00:00:00Z",
      response_value: "Pass",
      notes: "ok",
      unit: null,
      photo_ids: ["p1", "p2"],
    });
    expect(snapshot.items[1].photo_ids).toEqual([]);
  });

  it("seals a Number item's unit, so the printed record says what it measured", () => {
    const snapshot = checklistSnapshot(
      "Rough-in",
      "2026-02-02T00:00:00Z",
      [item({ item_type: "numeric", response_value: 42, unit: "psi" })],
      new Map(),
    );
    expect(snapshot.items[0].unit).toBe("psi");
  });

  it("blocks completion while a photo-required item has no photo", () => {
    const items = [
      item({ id: "a", photo_required: true }),
      item({ id: "b", photo_required: true }),
      item({ id: "c", photo_required: false }),
    ];
    expect(missingPhotoCount(items, new Map())).toBe(2);
    expect(checklistCompletionBlock(items, new Map())).toBe("2 photos still needed");
    expect(checklistCompletionBlock(items, new Map([["a", 1]]))).toBe("1 photo still needed");
    expect(
      checklistCompletionBlock(
        items,
        new Map([
          ["a", 1],
          ["b", 3],
        ]),
      ),
    ).toBeNull();
    // Without counts (not loaded yet) only the answer rule applies.
    expect(checklistCompletionBlock(items)).toBeNull();
  });

  it("names both reasons when required answers and photos are outstanding", () => {
    const items = [item({ id: "a", required: true, completed_at: null, photo_required: true })];
    expect(checklistCompletionBlock(items, new Map())).toBe(
      "1 required item still open, 1 photo still needed",
    );
  });

  it("counts attached photos per item", () => {
    expect(
      photoCountsOf(
        new Map([
          ["a", ["p1", "p2"]],
          ["b", []],
        ]),
      ),
    ).toEqual(
      new Map([
        ["a", 2],
        ["b", 0],
      ]),
    );
    expect(
      addCounts(
        new Map([["a", 1]]),
        new Map([
          ["a", 2],
          ["b", 1],
        ]),
      ),
    ).toEqual(
      new Map([
        ["a", 3],
        ["b", 1],
      ]),
    );
  });

  it("counts queued photos bound for an item, but not failed or unrelated rows", () => {
    const row = (over: Record<string, unknown>) => ({
      kind: "photo_upload",
      state: "pending",
      payload: JSON.stringify({ attachToChecklistItemId: "a" }),
      ...over,
    });
    const counts = queuedItemPhotoCounts([
      row({}),
      row({ state: "sending" }),
      row({ state: "failed" }),
      row({ payload: JSON.stringify({ attachToChecklistItemId: null }) }),
      row({ payload: "not json" }),
      row({ kind: "checklist_item_patch" }),
    ]);
    expect(counts).toEqual(new Map([["a", 2]]));
  });

  it("waits for queued answers on these items only", () => {
    const rows = [
      "checklist_item_patch:i1:answer",
      "checklist_item_patch:i1:notes",
      "checklist_item_patch:other:answer",
      "task_patch:i1",
    ];
    expect(pendingAnswerWrites(rows, ["i1"])).toBe(2);
    expect(pendingAnswerWrites(rows, ["i9"])).toBe(0);
  });

  it("says who was notified, as the web does", () => {
    expect(checklistCompletedMessage("boss", "me", "Pat")).toBe(
      "Checklist complete - Pat has been notified",
    );
    expect(checklistCompletedMessage(null, "me", "")).toBe(
      "Checklist marked complete - the record is sealed",
    );
    expect(workflowCompletedMessage("Install", "boss", "me", "Pat")).toBe(
      '"Install" complete - Pat has been notified',
    );
    expect(workflowCompletedMessage("Install", "me", "me", "")).toBe('"Install" marked complete');
  });
});

describe("workflowReadiness mirrors workflowState.canComplete", () => {
  const phase = (over: Record<string, unknown> = {}) => ({
    blocked: false,
    requiredTotal: 1,
    requiredDone: 1,
    signedOk: true,
    ...over,
  });

  it("needs at least one phase and none blocked", () => {
    expect(workflowReadiness([]).canComplete).toBe(false);
    expect(workflowReadiness([phase(), phase()]).canComplete).toBe(true);
  });

  it("explains required steps first, then sign-offs", () => {
    expect(
      workflowReadiness([phase({ blocked: true, requiredTotal: 3, requiredDone: 1 })]).reason,
    ).toBe("2 required steps left before this workflow can be closed.");
    expect(workflowReadiness([phase({ blocked: true, signedOk: false })]).reason).toBe(
      "1 sign-off left before this workflow can be closed.",
    );
  });
});

describe("the screens are wired and confirm destructive actions", () => {
  it("task detail and list delete behind a confirm, creator only", () => {
    for (const file of ["app/(app)/task/[id].tsx", "app/(app)/project/[id]/tasks.tsx"]) {
      const src = read(file);
      expect(src, file).toMatch(/canDeleteTask\(/);
      expect(src, file).toMatch(/deleteTask\(/);
      expect(src, file).toMatch(/Alert\.alert\(\s*"Delete this task\?"/);
    }
  });

  it("checklist runner keeps editing behind Edit mode and confirms deletes", () => {
    const src = read("app/(app)/checklist/[id].tsx");
    expect(src).toMatch(/editing && canStructure \?/);
    expect(src).toMatch(/<ChecklistEditPanel/);
    expect(src).toMatch(/Alert\.alert\("Delete this checklist\?"/);
    expect(src).toMatch(/Alert\.alert\("Remove this item\?"/);
    expect(src).toMatch(/"Reopen this checklist\?"/);
    expect(src).toMatch(/saveChecklistAsTemplate\(/);
    expect(src).toMatch(/completeChecklist\(/);
    expect(src).toMatch(/checklistSnapshot\(/);
    expect(src).toMatch(/overrideConfirm\(/);
    expect(src).toMatch(/recordPrintLinks\(/);
  });

  it("the edit panel offers every web answer type and a paste box", () => {
    const src = read("src/components/ChecklistEditor.tsx");
    expect(src).toMatch(/ITEM_TYPES\.map/);
    expect(src).toMatch(/parsePastedItems\(/);
  });

  it("workflow runner reopens, prints and confirms delete", () => {
    const src = read("app/(app)/workflow/[id].tsx");
    expect(src).toMatch(/reopenWorkflow\(/);
    expect(src).toMatch(/recordPrintLinks\(/);
    expect(src).toMatch(/completeWorkflow\(/);
    expect(src).toMatch(/workflowReadiness\(/);
    expect(src).toMatch(/overrideConfirm\(/);
    expect(src).toMatch(/Alert\.alert\("Delete this workflow\?"/);
  });

  it("deletes select the row back, so an RLS refusal is not silent", () => {
    for (const file of ["src/api/tasks.ts", "src/api/checklists.ts", "src/api/workflows.ts"]) {
      const src = read(file);
      expect(src, file).toMatch(/\.delete\(\)\s*\.eq\("id", \w+\)\s*\.select\("id"\)/);
    }
  });
});
