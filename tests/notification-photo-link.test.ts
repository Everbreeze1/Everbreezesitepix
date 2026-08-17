import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { notificationLinkTarget } from "../apps/web/src/lib/notification-link";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * A notification about one photo has to arrive at that photo.
 *
 * Both messages the photo viewer can send - "New task assigned to you" from the
 * tasks panel and "X mentioned you" from the comments panel - are written
 * against a single picture, and both linked at `/projects/<id>`. On a job
 * carrying a few hundred thumbnails that is a search handed to the person you
 * just gave work to, and it reads as a working feature the whole way: the
 * notification arrives, the tap navigates, a real page loads.
 *
 * Three separate pieces have to agree for the link to survive, in three
 * languages, which is why they are pinned together here:
 *
 *   1. the DB trigger and the mention service, which WRITE the link
 *   2. `notificationLinkTarget`, which SPLITS it for the router
 *   3. the route's validateSearch, which ACCEPTS the param
 *
 * Break any one and the other two still look right.
 */
describe("a photo notification opens the photo", () => {
  describe("splitting the stored link for the router", () => {
    /*
     * Both call sites passed `linkPath` to `navigate({ to })` whole. TanStack
     * Router reads `to` as a pathname, so a stored "/projects/x?photo=y" would
     * resolve as a route literally named "x?photo=y" - a 404 for a link that is
     * perfectly well formed.
     */
    it("pulls the query string out into search params", () => {
      expect(notificationLinkTarget("/projects/abc?photo=xyz")).toEqual({
        to: "/projects/abc",
        search: { photo: "xyz" },
      });
    });

    it("leaves a bare path exactly as it was", () => {
      // Every notification written before this change, and every task that
      // carries no photo, still takes this branch.
      expect(notificationLinkTarget("/projects/abc")).toEqual({ to: "/projects/abc" });
      expect(notificationLinkTarget("/notifications")).toEqual({ to: "/notifications" });
    });

    it("treats a trailing ? as a path, not as an empty search", () => {
      // `search: {}` would have the router rewrite the URL for no reason.
      expect(notificationLinkTarget("/projects/abc?")).toEqual({ to: "/projects/abc" });
    });

    it("decodes values rather than handing the router a percent-escape", () => {
      expect(notificationLinkTarget("/projects/abc?photo=a%20b").search).toEqual({ photo: "a b" });
    });
  });

  describe("the two writers", () => {
    it("the assignee trigger appends the task's photo, and only when it has one", () => {
      const sql = read(
        "supabase/migrations/20260905000000_task_notification_links_to_its_photo.sql",
      );
      // The live statement, not the prose above it: the header quotes the old
      // link and would satisfy a naive scan on its own.
      const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"));
      expect(body).toMatch(/\?photo=/);
      expect(body).toMatch(/photo_ids\[1\]/);
      // A task with no photos has to keep the link it always had, so the
      // suffix must be conditional rather than always concatenated.
      expect(body).toMatch(/COALESCE\(\s*'\?photo='/);
      // Replaced in place. Dropping and recreating the trigger would lose any
      // assignment made between the two statements.
      expect(body).not.toMatch(/DROP TRIGGER/);
    });

    it("the mention notification links at the photo it was written on", () => {
      const src = read("apps/api/src/domains/photos/comments.ts");
      expect(src).toMatch(
        /linkPath: `\/projects\/\$\{typed\.project_id\}\?photo=\$\{typed\.photo_id\}`/,
      );
    });
  });

  describe("the reader", () => {
    it("the project route accepts ?photo and shape-checks it", () => {
      const src = read("apps/web/src/routes/_app.projects.$projectId.tsx");
      expect(src).toMatch(/photo:/);
      // The value is looked up against loaded photos, so anything that is not
      // an id can only produce a toast about a photo nobody linked.
      expect(src).toMatch(/\[0-9a-f\]\{8\}-/);
    });

    it("the project page opens the viewer on it and clears the reader's filters", () => {
      const src = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");
      expect(src).toMatch(/setPendingPhotoId\(search\.photo\)/);
      /*
       * The phase and tag filters belong to the reader, not the sender. They
       * bite when the reader is already on this project with one applied: the
       * router keeps the page mounted and swaps only the search param, so the
       * filter is live and hides the linked photo exactly as convincingly as a
       * deleted one. That is the failure this guards.
       */
      expect(src).toMatch(/setPhaseFilter\("all"\)/);
      expect(src).toMatch(/setTagFilter\(\[\]\)/);
      // Cleared after use, like ?camera=1, so a back-nav does not reopen it.
      expect(src).toMatch(/photo: undefined/);
    });

    it("neither notification surface navigates with the raw stored string", () => {
      for (const rel of [
        "apps/web/src/components/AppHeader.tsx",
        "apps/web/src/features/notifications/pages/NotificationsPage.tsx",
      ]) {
        const src = read(rel);
        expect(src, rel).toMatch(/notificationLinkTarget\(n\.linkPath\)/);
        expect(src, rel).not.toMatch(/navigate\(\{\s*to:\s*n\.linkPath\s*\}\)/);
      }
    });
  });
});
