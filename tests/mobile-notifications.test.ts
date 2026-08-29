import { describe, expect, it } from "vitest";
import {
  inboxSummary,
  markedRead,
  notificationGlyph,
  notificationTarget,
  notificationTone,
  unreadCount,
  type NotificationTargetInput,
} from "../apps/mobile/src/api/notification-target";

/*
 * Notification routing.
 *
 * The whole reason this is a module rather than a switch inside the screen is
 * that `link_path` is written for the **web** router. `/projects/<id>?task=<id>`
 * means nothing to expo-router: there is no `/projects` route on the phone, and
 * a task opens its own screen rather than a query param on the project. Handing
 * those strings straight to `router.push` navigates to a route that does not
 * exist, and the failure is silent: a tap that does nothing looks exactly like
 * a tap on a row that has not finished loading.
 *
 * The paths below are not invented. Each one is copied from a trigger in
 * `supabase/migrations/*.sql` or a service in `apps/api/src/domains`.
 */

const base: NotificationTargetInput = {
  type: "task_assigned",
  linkPath: null,
  projectId: null,
  entityType: null,
  entityId: null,
};

const P = "11111111-1111-1111-1111-111111111111";
const E = "22222222-2222-2222-2222-222222222222";

describe("notificationTarget: the structured columns", () => {
  it("sends a task notification to the task screen, not its project", () => {
    // What the reader asked for is the task. Opening its project instead makes
    // them hunt through a list for the row the notification was about.
    expect(notificationTarget({ ...base, entityType: "task", entityId: E, projectId: P })).toEqual({
      pathname: "/task/[id]",
      params: { id: E, projectId: P },
    });
  });

  it("passes projectId through as a hint, and copes without one", () => {
    // The task screen renders its header from the hint before the row itself
    // has loaded. Absent is fine; wrong would not be.
    expect(notificationTarget({ ...base, entityType: "task", entityId: E })).toEqual({
      pathname: "/task/[id]",
      params: { id: E },
    });
  });

  it("routes checklists and workflows to their own runners", () => {
    expect(
      notificationTarget({
        ...base,
        type: "checklist_assigned",
        entityType: "checklist",
        entityId: E,
      }),
    ).toEqual({ pathname: "/checklist/[id]", params: { id: E } });

    expect(
      notificationTarget({
        ...base,
        type: "workflow_assigned",
        entityType: "workflow",
        entityId: E,
      }),
    ).toEqual({ pathname: "/workflow/[id]", params: { id: E } });
  });

  it("prefers the columns over the path when they disagree", () => {
    /*
     * They should never disagree, because one trigger writes both. But if they
     * ever do, the columns are the ones that cannot silently rot when a web
     * route is renamed.
     */
    expect(
      notificationTarget({
        ...base,
        entityType: "task",
        entityId: E,
        projectId: P,
        linkPath: "/projects/somewhere-else",
      }),
    ).toEqual({ pathname: "/task/[id]", params: { id: E, projectId: P } });
  });

  it("ignores an entity type with no screen behind it", () => {
    // `photo_comment` is a real entity_type and has no route: photos live in
    // the project lightbox. It has to fall through to the project rather than
    // push "/photo_comment/[id]".
    expect(
      notificationTarget({
        ...base,
        type: "photo_comment_mention",
        entityType: "photo_comment",
        entityId: E,
        projectId: P,
        linkPath: `/projects/${P}?photo=${E}`,
      }),
    ).toEqual({ pathname: "/project/[id]", params: { id: P, photo: E } });
  });
});

describe("notificationTarget: reading a web link path", () => {
  it("maps the web /projects segment onto the phone's /project", () => {
    // The plural is the entire bug this module exists for.
    expect(notificationTarget({ ...base, linkPath: `/projects/${P}` })).toEqual({
      pathname: "/project/[id]",
      params: { id: P },
    });
  });

  it("turns ?task= into the task screen", () => {
    // Written by the task comment and task watcher triggers.
    expect(notificationTarget({ ...base, linkPath: `/projects/${P}?task=${E}` })).toEqual({
      pathname: "/task/[id]",
      params: { id: E, projectId: P },
    });
  });

  it("carries ?photo= through as a deep link into the lightbox", () => {
    // Written by the photo comment mention path in
    // `apps/api/src/domains/photos/comments.ts`.
    expect(notificationTarget({ ...base, linkPath: `/projects/${P}?photo=${E}` })).toEqual({
      pathname: "/project/[id]",
      params: { id: P, photo: E },
    });
  });

  it("maps the nested checklist path", () => {
    expect(notificationTarget({ ...base, linkPath: `/projects/${P}/checklists/${E}` })).toEqual({
      pathname: "/checklist/[id]",
      params: { id: E },
    });
  });

  it("returns null for a surface the phone has no screen for", () => {
    /*
     * Null is a real answer, not a failure. `/teams`, `/settings` and
     * `/report-issue` notifications still read and still mark themselves read;
     * they just do not navigate, which beats pushing a route that renders
     * blank.
     */
    for (const path of ["/teams", "/settings", "/report-issue", "/", ""]) {
      expect(notificationTarget({ ...base, linkPath: path })).toBeNull();
    }
    expect(notificationTarget(base)).toBeNull();
  });
});

describe("notificationTarget: hostile input", () => {
  it("refuses an id that would invent a route segment", () => {
    /*
     * `entity_id` is a uuid column, so this can only come from a hand-written
     * row. An id containing a slash would push an extra segment into `pathname`
     * and land somewhere unrelated, and it would only reproduce on that one
     * row.
     */
    const target = notificationTarget({
      ...base,
      entityType: "task",
      entityId: "../../account",
      projectId: P,
    });
    expect(target).toEqual({ pathname: "/project/[id]", params: { id: P } });
  });

  it("drops a photo param that is not a plain id", () => {
    expect(
      notificationTarget({ ...base, projectId: P, linkPath: `/projects/${P}?photo=a/b` }),
    ).toEqual({ pathname: "/project/[id]", params: { id: P } });
  });

  it("survives a path with a trailing question mark and an empty value", () => {
    expect(notificationTarget({ ...base, linkPath: `/projects/${P}?` })).toEqual({
      pathname: "/project/[id]",
      params: { id: P },
    });
    expect(notificationTarget({ ...base, linkPath: `/projects/${P}?photo=` })).toEqual({
      pathname: "/project/[id]",
      params: { id: P },
    });
  });

  it("decodes a percent-encoded value", () => {
    expect(
      notificationTarget({ ...base, linkPath: `/projects/${P}?photo=${encodeURIComponent(E)}` }),
    ).toEqual({ pathname: "/project/[id]", params: { id: P, photo: E } });
  });
});

describe("notificationGlyph", () => {
  it("gives comments a speech bubble, not a checkbox", () => {
    // `task_comment` starts with "task_" and is not a task arriving. Getting
    // this wrong makes a conversation look like an assignment.
    expect(notificationGlyph("task_comment")).toBe("comment");
    expect(notificationGlyph("photo_comment_mention")).toBe("comment");
  });

  it("groups the task, checklist and workflow families", () => {
    expect(notificationGlyph("task_assigned")).toBe("task");
    expect(notificationGlyph("task_completed")).toBe("task");
    expect(notificationGlyph("task_updated")).toBe("task");
    expect(notificationGlyph("checklist_completed")).toBe("checklist");
    expect(notificationGlyph("workflow_assigned")).toBe("workflow");
  });

  it("has an answer for a type this build has never heard of", () => {
    // The column is plain text upstream and the server has added five types
    // since the table was created. An older build still has to render them.
    expect(notificationGlyph("invoice_overdue")).toBe("announcement");
    expect(notificationGlyph("")).toBe("announcement");
  });
});

describe("notificationTone", () => {
  it("keeps green for work finishing", () => {
    expect(notificationTone("task_completed")).toBe("success");
    expect(notificationTone("checklist_completed")).toBe("success");
  });

  it("keeps blue for work arriving", () => {
    expect(notificationTone("task_assigned")).toBe("primary");
    expect(notificationTone("project_assigned")).toBe("primary");
  });

  it("leaves everything else neutral", () => {
    // Colouring nine of thirteen types makes the list a rainbow and stops the
    // colour carrying information.
    expect(notificationTone("task_comment")).toBe("muted");
    expect(notificationTone("admin_announcement")).toBe("muted");
  });
});

describe("markedRead", () => {
  const items = [
    { id: "a", readAt: null },
    { id: "b", readAt: "2026-08-01T00:00:00.000Z" },
    { id: "c", readAt: null },
  ];

  it("stamps only the ids named, and only the unread ones", () => {
    const out = markedRead(items, new Set(["a", "b"]), "2026-08-29T10:00:00.000Z");
    expect(out[0].readAt).toBe("2026-08-29T10:00:00.000Z");
    // Already read keeps its original stamp. Restamping would reorder any list
    // sorted by when something was read.
    expect(out[1].readAt).toBe("2026-08-01T00:00:00.000Z");
    expect(out[2].readAt).toBeNull();
  });

  it("returns the same array when nothing changed", () => {
    /*
     * `useInfiniteQuery` stores pages, so this runs once per page. Returning
     * the identical array for a page with no unread rows is what lets the
     * screen skip re-rendering it.
     */
    expect(markedRead(items, new Set(), "x")).toBe(items);
    expect(markedRead(items, new Set(["b"]), "x")).toBe(items);
    expect(markedRead(items, new Set(["nope"]), "x")).toBe(items);
  });

  it("does not mutate what it was given", () => {
    markedRead(items, new Set(["a"]), "2026-08-29T10:00:00.000Z");
    expect(items[0].readAt).toBeNull();
  });
});

describe("unreadCount and inboxSummary", () => {
  it("counts the unread", () => {
    expect(unreadCount([{ readAt: null }, { readAt: "x" }, { readAt: null }])).toBe(2);
    expect(unreadCount([])).toBe(0);
  });

  it("says something useful at every count", () => {
    expect(inboxSummary(0, 0)).toBe("Nothing yet");
    expect(inboxSummary(1, 0)).toBe("1 notification, all read");
    expect(inboxSummary(4, 0)).toBe("4 notifications, all read");
    expect(inboxSummary(4, 2)).toBe("2 unread of 4");
  });
});
