import { describe, expect, it } from "vitest";
import {
  canPrompt,
  deviceLabel,
  pushBlocked,
  pushStatusLabel,
  readPushData,
} from "../apps/mobile/src/api/push-view";

/*
 * Push, tested here because it cannot be tested anywhere else.
 *
 * `expo-notifications` refuses to mint a token without real hardware, so none
 * of this can be exercised on the emulator the rest of the app is checked on.
 * Testing the decisions directly is the only way to know they are right before
 * they reach a phone.
 */

describe("pushBlocked", () => {
  it("is clear when everything is in place", () => {
    expect(pushBlocked({ isDevice: true, permission: "granted", projectId: "abc" })).toBeNull();
  });

  it("reports the simulator first, because it is the one nobody can fix", () => {
    /*
     * Asking for permission on a simulator succeeds and then fails to mint a
     * token, which reads as a bug. Checking hardware first means the person is
     * told the actual limitation instead.
     */
    expect(pushBlocked({ isDevice: false, permission: "granted", projectId: "abc" })).toBe(
      "simulator",
    );
    expect(pushBlocked({ isDevice: false, permission: "denied", projectId: null })).toBe(
      "simulator",
    );
  });

  it("separates our misconfiguration from their decision", () => {
    // A missing project id is ours and no amount of tapping in Settings fixes
    // it. A denied permission is theirs and Settings is exactly where it lives.
    expect(pushBlocked({ isDevice: true, permission: "granted", projectId: null })).toBe(
      "no_project_id",
    );
    expect(pushBlocked({ isDevice: true, permission: "denied", projectId: "abc" })).toBe("denied");
    expect(pushBlocked({ isDevice: true, permission: "undetermined", projectId: "abc" })).toBe(
      "denied",
    );
  });
});

describe("pushStatusLabel", () => {
  it("sends somebody to the right place, or nowhere", () => {
    expect(pushStatusLabel("simulator", false)).toContain("simulator");
    expect(pushStatusLabel("denied", false)).toContain("phone settings");
    // Deliberately does not say "turned off": that would send somebody into
    // Settings to fix something that is not there.
    expect(pushStatusLabel("no_project_id", false)).not.toContain("settings");
    expect(pushStatusLabel("no_project_id", false)).toContain("build");
  });

  it("distinguishes registered from still working on it", () => {
    expect(pushStatusLabel(null, true)).toBe("On for this phone");
    expect(pushStatusLabel(null, false)).toBe("Setting up");
  });

  it("does not leave a failed registration claiming to be in progress", () => {
    /*
     * The bug this covers. A failed mint used to reset the reason to null,
     * which renders as "Setting up", so the row sat there saying something was
     * happening when nothing was and nothing would. Found on the device after
     * watching it not change for half a minute.
     */
    const label = pushStatusLabel("unavailable", false);
    expect(label).not.toBe("Setting up");
    expect(label).toContain("try again");
  });
});

describe("canPrompt", () => {
  it("prompts on a fresh install", () => {
    expect(canPrompt("undetermined", true)).toBe(true);
  });

  it("does not prompt again after a refusal the system will not re-show", () => {
    /*
     * Both platforms stop showing the prompt after the first refusal, so a
     * second request resolves denied instantly and the button looks dead.
     */
    expect(canPrompt("denied", false)).toBe(false);
  });

  it("prompts again when the system says it still will", () => {
    expect(canPrompt("denied", true)).toBe(true);
  });
});

describe("deviceLabel", () => {
  it("uses the name when there is one", () => {
    expect(deviceLabel("Sam's iPhone", "ios")).toBe("Sam's iPhone");
  });

  it("never renders null in a list of somebody's phones", () => {
    // `expo-device` returns null on an emulator. A row reading "null" is the
    // "unfriendly info" complaint in a new place.
    expect(deviceLabel(null, "ios")).toBe("An iPhone");
    expect(deviceLabel("   ", "android")).toBe("An Android phone");
    expect(deviceLabel(undefined, "android")).toBe("An Android phone");
  });
});

describe("readPushData", () => {
  it("reads the routing fields", () => {
    expect(
      readPushData({
        linkPath: "/projects/p1?task=t1",
        projectId: "p1",
        entityType: "task",
        entityId: "t1",
        type: "task_assigned",
      }),
    ).toEqual({
      linkPath: "/projects/p1?task=t1",
      projectId: "p1",
      entityType: "task",
      entityId: "t1",
      type: "task_assigned",
    });
  });

  it("survives a payload of any shape at all", () => {
    /*
     * The payload arrives as `unknown` from the native side and is written by
     * the server. A malformed push has to open the app, not crash it, and it
     * crashes on launch if it crashes at all: handling a tapped notification is
     * one of the first things that runs.
     */
    expect(readPushData(null)).toEqual({});
    expect(readPushData(undefined)).toEqual({});
    expect(readPushData("a string")).toEqual({});
    expect(readPushData(42)).toEqual({});
    expect(readPushData([])).toEqual({
      linkPath: null,
      projectId: null,
      entityType: null,
      entityId: null,
      type: null,
    });
  });

  it("drops fields that are the wrong type or empty", () => {
    const out = readPushData({ linkPath: 42, projectId: "", entityType: "task", entityId: null });
    expect(out.linkPath).toBeNull();
    expect(out.projectId).toBeNull();
    expect(out.entityType).toBe("task");
    expect(out.entityId).toBeNull();
  });
});
