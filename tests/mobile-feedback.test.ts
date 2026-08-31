import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendErrorLog,
  cleanDescription,
  contextAsText,
  deviceUserAgent,
  feedbackRow,
  KINDS,
  MAX_DESCRIPTION,
  messageError,
  type DeviceContext,
} from "../apps/mobile/src/api/feedback-view";

/*
 * Reporting a problem from the field.
 *
 * Two clients write `issue_reports`, and the column names are the thing to get
 * right: the web already shipped a bug where the text column was called
 * `message` instead of `description`, and its own comment says so. The last
 * block below checks the mobile row against the web's `baseRow` by reading it,
 * rather than by my having copied it carefully once.
 */

const context: DeviceContext = {
  platform: "android",
  osVersion: "14",
  model: "Pixel 7",
  appVersion: "0.1.0",
  screen: "/team",
};

describe("messageError", () => {
  it("requires something to act on", () => {
    expect(messageError("")).toContain("what happened");
    expect(messageError("   ")).toContain("what happened");
  });

  it("has a floor, not just a cap", () => {
    /*
     * "broken" is a report nobody can act on, and the person who sent it has
     * spent their goodwill without getting a fix. Asking for one more sentence
     * costs less than a round trip through support.
     */
    expect(messageError("broken")).toContain("sentence");
    expect(messageError("The team screen does not load")).toBeNull();
  });
});

describe("cleanDescription", () => {
  it("trims and caps to what the column takes", () => {
    expect(cleanDescription("  hello  ")).toBe("hello");
    expect(cleanDescription("x".repeat(5000))).toHaveLength(MAX_DESCRIPTION);
  });
});

describe("deviceUserAgent", () => {
  it("composes something an admin can read, rather than leaving it null", () => {
    /*
     * The column holds a browser UA from the web. An empty one on a mobile
     * report would make an admin work out from an absence that it came from the
     * app.
     */
    const ua = deviceUserAgent(context);
    expect(ua).toContain("EverlumenApp");
    expect(ua).toContain("android");
    expect(ua).toContain("Pixel 7");
  });

  it("survives a device that reports nothing about itself", () => {
    // `expo-device` returns null for the model on an emulator.
    const ua = deviceUserAgent({
      platform: "ios",
      osVersion: null,
      model: null,
      appVersion: null,
      screen: null,
    });
    expect(ua).toContain("EverlumenApp");
    expect(ua).not.toContain("null");
  });

  it("caps at 500, matching the web's slice", () => {
    const ua = deviceUserAgent({ ...context, model: "x".repeat(900) });
    expect(ua.length).toBeLessThanOrEqual(500);
  });
});

describe("appendErrorLog", () => {
  it("attaches the recent errors when asked", () => {
    /*
     * The reason `error-redaction.ts` exists. A crew member reporting "the team
     * screen did not work" cannot say what the error was, and until now nothing
     * on the phone could either.
     */
    const out = appendErrorLog("It broke", "query my-team\n  Request failed", true);
    expect(out).toContain("It broke");
    expect(out).toContain("Request failed");
  });

  it("leaves the report alone when not asked, or when there is nothing", () => {
    expect(appendErrorLog("It broke", "some errors", false)).toBe("It broke");
    expect(appendErrorLog("It broke", "   ", true)).toBe("It broke");
  });

  it("still respects the column cap once the log is attached", () => {
    const out = appendErrorLog("x".repeat(3900), "y".repeat(900), true);
    expect(out).toHaveLength(MAX_DESCRIPTION);
  });
});

describe("feedbackRow", () => {
  const row = () =>
    feedbackRow({
      kind: "bug",
      description: "The team screen does not load",
      userId: "u1",
      email: "sam@site.test",
      screen: "/team",
      context,
    });

  it("writes `description`, never `message`", () => {
    // The exact mistake the web already shipped once.
    const r = row();
    expect(r.description).toBe("The team screen does not load");
    expect(r).not.toHaveProperty("message");
  });

  it("groups by the screen, which is the axis the admin queue uses", () => {
    expect(row().feature).toBe("/team");
  });

  it("derives sentiment from the kind rather than asking twice", () => {
    expect(row().sentiment).toBe("bad");
    expect(
      feedbackRow({
        ...{ kind: "praise" as const },
        description: "d",
        userId: null,
        email: null,
        screen: null,
        context,
      }).sentiment,
    ).toBe("good");
    expect(
      feedbackRow({
        ...{ kind: "idea" as const },
        description: "d",
        userId: null,
        email: null,
        screen: null,
        context,
      }).sentiment,
    ).toBeNull();
  });

  it("puts an app URL in `url`, so a mobile report is identifiable", () => {
    expect(row().url).toBe("app://team");
  });

  it("copes with a report sent from nowhere in particular", () => {
    const r = feedbackRow({
      kind: "idea",
      description: "d",
      userId: null,
      email: null,
      screen: null,
      context,
    });
    expect(r.url).toBeNull();
    expect(r.feature).toBeNull();
  });
});

describe("contextAsText", () => {
  it("folds the structured context into the body for the retry", () => {
    /*
     * Migrations here are applied by hand, so `client_info` and `project_id`
     * may not be on the table yet. The web hit this and solved it the same way.
     */
    const text = contextAsText(context, "p1");
    expect(text).toContain("android 14");
    expect(text).toContain("Pixel 7");
    expect(text).toContain("p1");
  });

  it("omits what the device did not report, rather than writing null", () => {
    const text = contextAsText(
      { platform: "ios", osVersion: null, model: null, appVersion: null, screen: null },
      null,
    );
    expect(text).not.toContain("null");
    expect(text).toContain("ios");
  });
});

describe("KINDS", () => {
  it("describes each kind by what the reporter is telling you", () => {
    // "bug" and "idea" are our words. A person reports that something is
    // broken or missing.
    expect(KINDS.map((k) => k.id).sort()).toEqual(["bug", "idea", "praise"]);
    for (const kind of KINDS) expect(kind.hint.length).toBeGreaterThan(0);
  });
});

describe("the two clients agree on the columns", () => {
  it("writes the same fields the web writes", () => {
    /*
     * Two clients writing one table with different column names is how the
     * `description` / `message` confusion happened. Read from the web source
     * rather than trusting that I copied it correctly.
     */
    const web = readFileSync(join(process.cwd(), "apps/web/src/lib/feedback.ts"), "utf8");
    const baseRow = web.slice(
      web.indexOf("function baseRow"),
      web.indexOf("function baseRow") + 900,
    );

    const webFields = new Set([...baseRow.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]));
    const mobileFields = new Set(
      Object.keys(
        feedbackRow({
          kind: "bug",
          description: "d",
          userId: null,
          email: null,
          screen: null,
          context,
        }),
      ),
    );

    expect(webFields.size).toBeGreaterThan(5);
    for (const field of webFields) {
      expect(mobileFields, `mobile is missing the web's "${field}" column`).toContain(field);
    }
  });
});
