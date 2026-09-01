import { describe, expect, it } from "vitest";
import {
  photoIsDone,
  taskPhotoProgress,
  taskWorkSummary,
  type TaskPhotoItem,
} from "../packages/shared/src/task-photo-items";

/*
 * A Map does not survive the query cache.
 *
 * The mobile app wraps its React Query client in `PersistQueryClientProvider`
 * with an AsyncStorage persister, so cached query data is written out as JSON.
 * `JSON.stringify(new Map([["a", 1]]))` is `"{}"`, and what comes back on the
 * next launch is a plain object with no `.get`.
 *
 * `getTaskPhotoState` returns `items: Map<string, TaskPhotoItem>`. On a fresh
 * fetch that is true. After the app is restarted with a warm cache the very
 * same query hands back an object, `itemsForTask?.get(id)` throws
 *
 *     TypeError: undefined is not a function
 *
 * and the task detail screen renders a red error box where the task should be.
 *
 * Nothing caught it: the type is Map and is correct about the fetch, tsc has no
 * view of what a persister does to the value in between, and in development the
 * screen works right up until the first restart with a populated cache. Found
 * by opening a task on the phone after the app had been restarted.
 *
 * The round trip below is real - `JSON.parse(JSON.stringify(...))` - rather
 * than a hand-written object literal, so the test reproduces the actual
 * mechanism instead of my description of it.
 */

const ITEMS: [string, TaskPhotoItem][] = [
  ["photo-a", { photo_id: "photo-a", status: "done" } as TaskPhotoItem],
  ["photo-b", { photo_id: "photo-b", status: "todo" } as TaskPhotoItem],
];

/** What the persister actually hands back on the next launch. */
function rehydrated(): Record<string, TaskPhotoItem> {
  const fresh = Object.fromEntries(ITEMS);
  return JSON.parse(JSON.stringify(fresh)) as Record<string, TaskPhotoItem>;
}

describe("a Map really does not survive JSON", () => {
  it("stringifies to an empty object, which is the whole bug", () => {
    // Stated as a test so nobody has to take the comment on trust.
    expect(JSON.stringify(new Map(ITEMS))).toBe("{}");
  });
});

describe("task progress reads either shape", () => {
  it("works on a fresh fetch, where items is a Map", () => {
    const progress = taskPhotoProgress(["photo-a", "photo-b"], new Map(ITEMS));
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(2);
  });

  it("works after a restart, where items came back as a plain object", () => {
    // The call that threw "undefined is not a function".
    const progress = taskPhotoProgress(["photo-a", "photo-b"], rehydrated());
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(2);
  });

  it("agrees with itself across the two shapes", () => {
    /*
     * The part that matters beyond not crashing: a task must not read "1 of 2"
     * before a restart and "0 of 2" after one. A lookup that silently found
     * nothing would keep the screen alive and quietly report the wrong state,
     * which is worse than the error box.
     */
    const fresh = taskPhotoProgress(["photo-a", "photo-b"], new Map(ITEMS));
    const stored = taskPhotoProgress(["photo-a", "photo-b"], rehydrated());
    expect(stored).toEqual(fresh);
  });
});

describe("the other lookups too", () => {
  it("photoIsDone reads a rehydrated object", () => {
    expect(photoIsDone(rehydrated(), "photo-a")).toBe(true);
    expect(photoIsDone(rehydrated(), "photo-b")).toBe(false);
  });

  it("taskWorkSummary agrees across both shapes", () => {
    const fresh = taskWorkSummary(["photo-a", "photo-b"], new Map(ITEMS));
    const stored = taskWorkSummary(["photo-a", "photo-b"], rehydrated());
    expect(stored).toEqual(fresh);
  });

  it("still copes with nothing at all", () => {
    // The original null guard has to survive the change.
    expect(photoIsDone(null, "photo-a")).toBe(false);
    expect(photoIsDone(undefined, "photo-a")).toBe(false);
    expect(taskPhotoProgress(["photo-a"], null).done).toBe(0);
  });
});
