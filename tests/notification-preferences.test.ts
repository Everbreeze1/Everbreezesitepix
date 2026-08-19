import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  NOTIFICATION_PREF_DEFAULTS,
  NOTIFICATION_TYPE_PREF,
  emailAllowed,
  parseNotificationPrefs,
  prefEnabled,
} from "../packages/shared/src/notification-prefs";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const MIGRATION = read("supabase/migrations/20260916000000_notification_preferences.sql");
const SETTINGS = read("apps/web/src/features/settings/pages/SettingsPage.tsx");
const SENDER = read("apps/api/src/domains/tasks/service.ts");

/**
 * A switch has to control something.
 *
 * Settings has had an "Email notifications" toggle since the first build, and
 * it wrote to `localStorage` - one browser, one device, unreadable by any
 * server. That cost nothing for as long as the product sent no email about
 * work. Task assignment email ends that: a crew member who turns email off
 * would keep receiving it, and their only remaining control is the spam button,
 * which takes the invites and password resets down with it.
 *
 * These pin the two halves: the rule (a sparse object where absence means the
 * default) and the fact that the sender and the screen both go through it.
 */
describe("notification preferences", () => {
  describe("absence means the default, not off", () => {
    it("an untouched account gets everything", () => {
      // Every existing row is `{}` the moment the migration runs. If this were
      // read as "all off", one migration would unsubscribe the entire customer
      // base in silence.
      expect(emailAllowed({}, "task_assigned")).toBe(true);
      expect(emailAllowed(null, "task_assigned")).toBe(true);
      expect(emailAllowed(undefined, "task_comment")).toBe(true);
    });

    it("reads a switch that was explicitly set", () => {
      expect(prefEnabled({ taskAssigned: false }, "taskAssigned")).toBe(false);
      expect(prefEnabled({ taskAssigned: true }, "taskAssigned")).toBe(true);
      // A key somebody never touched still reads as its default.
      expect(prefEnabled({ taskAssigned: false }, "taskComments")).toBe(true);
    });

    it("every default is on - these are messages about work you were handed", () => {
      expect(Object.values(NOTIFICATION_PREF_DEFAULTS).every((v) => v === true)).toBe(true);
    });
  });

  describe("the master switch wins", () => {
    it("email off means no email, whatever the topic rows say", () => {
      const prefs = { emailEnabled: false, taskAssigned: true, taskComments: true };
      expect(emailAllowed(prefs, "task_assigned")).toBe(false);
      expect(emailAllowed(prefs, "task_comment")).toBe(false);
      expect(emailAllowed(prefs, "anything_at_all")).toBe(false);
    });

    it("a topic off only silences that topic", () => {
      const prefs = { taskComments: false };
      expect(emailAllowed(prefs, "task_comment")).toBe(false);
      expect(emailAllowed(prefs, "task_assigned")).toBe(true);
    });
  });

  describe("a type nobody has written a row for", () => {
    it("is governed by the master switch alone, and defaults to reaching people", () => {
      // Deliberate: a new notification type should reach people and get a row
      // when somebody decides it deserves one, rather than be silently
      // ungovernable OR silently suppressed.
      expect(NOTIFICATION_TYPE_PREF["team_invite_accepted"]).toBeUndefined();
      expect(emailAllowed({}, "team_invite_accepted")).toBe(true);
      expect(emailAllowed({ emailEnabled: false }, "team_invite_accepted")).toBe(false);
    });

    it("every task notification type the triggers raise has a row", () => {
      // If a type is added to the migration without a row here, it becomes
      // unopt-outable. Named explicitly so that is a failing test, not a
      // discovery made from a complaint.
      for (const type of [
        "task_assigned",
        "task_comment",
        "task_updated",
        "task_watching",
        "task_completed",
      ]) {
        expect(NOTIFICATION_TYPE_PREF[type]).toBeDefined();
      }
    });
  });

  describe("reading whatever jsonb actually holds", () => {
    it("drops unknown keys and non-booleans rather than trusting them", () => {
      expect(
        parseNotificationPrefs({
          emailEnabled: false,
          taskAssigned: "no",
          somethingElse: true,
        }),
      ).toEqual({ emailEnabled: false });
    });

    it("treats junk as no preference expressed, which is every default", () => {
      // A malformed column must not read as an accidental unsubscribe.
      for (const junk of [null, undefined, "off", 42, [], true]) {
        expect(parseNotificationPrefs(junk)).toEqual({});
        expect(emailAllowed(parseNotificationPrefs(junk), "task_assigned")).toBe(true);
      }
    });
  });

  describe("the column, and the two places that read it", () => {
    it("lives on profiles, which already has own-row RLS", () => {
      expect(MIGRATION).toContain(
        "ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb",
      );
      // No new policy: 20260618045310 already scopes profiles to own-row SELECT
      // and UPDATE, which is exactly "your preferences are yours".
      expect(MIGRATION).not.toContain("CREATE POLICY");
    });

    it("the sender consults it before sending", () => {
      expect(SENDER).toContain("emailAllowed");
      expect(SENDER).toContain("notificationPrefsById");
    });

    it("the sender fails open when the column is not there yet", () => {
      // Migrations here are pasted into the SQL editor by hand, so the code can
      // land first. A missing column must not read as everyone unsubscribed.
      const fn = SENDER.slice(
        SENDER.indexOf("async function notificationPrefsById"),
        SENDER.indexOf("function displayName"),
      );
      expect(fn).toContain("if (error)");
      expect(fn).toContain("return map;");
    });

    it("the settings screen writes to the profile, not to localStorage", () => {
      const section = SETTINGS.slice(
        SETTINGS.indexOf("function NotificationsSection()"),
        SETTINGS.indexOf("function ChannelCard("),
      );
      expect(section).toContain("notification_prefs");
      // The old key is read once, for people who set something before this
      // shipped. It must never be written to again, or the two copies drift.
      expect(section).toContain("localStorage.getItem(NOTIF_KEY");
      expect(section).not.toContain("localStorage.setItem(NOTIF_KEY");
    });

    it("no switch is shown for a channel with no sender behind it", () => {
      const section = SETTINGS.slice(
        SETTINGS.indexOf("function NotificationsSection()"),
        SETTINGS.indexOf("function ChannelCard("),
      );
      // Push has no service worker and no VAPID keys in this deployment. It is
      // shown as unavailable rather than as an operable switch.
      expect(section).toContain("Not available yet");
      expect(section).toMatch(/disabled\b/);
      // And the rows that used to name things nothing sends are gone.
      for (const dead of ["commentsOnMyPhotos", "repliesToMyComments", "weeklyDigest"]) {
        expect(section).not.toContain(dead);
      }
    });
  });
});
