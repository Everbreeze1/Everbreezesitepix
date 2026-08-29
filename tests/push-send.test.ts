import { describe, expect, it } from "vitest";
import {
  batches,
  devicesByUser,
  EXPO_BATCH_SIZE,
  expoMessagesFor,
  isExpoToken,
  isPushable,
  tokensToDrop,
  type ExpoMessage,
  type PushableNotification,
} from "../apps/api/src/domains/notifications/push";

/*
 * The push send path.
 *
 * None of this can be exercised without real phones registered against real
 * Expo tokens, so the rules are tested directly. Two of them have consequences
 * that would be very hard to notice in production: pairing Expo's positional
 * response against the wrong messages deletes working tokens, and one malformed
 * token in a batch makes Expo reject every message alongside it.
 */

const row = (over: Partial<PushableNotification> = {}): PushableNotification => ({
  id: "n1",
  recipient_id: "u1",
  type: "task_assigned",
  title: "Reseal the flashing",
  body: "Assigned by Sam",
  link_path: "/projects/p1?task=t1",
  project_id: "p1",
  entity_type: "task",
  entity_id: "t1",
  ...over,
});

const devices = (...pairs: [string, string][]) =>
  devicesByUser(pairs.map(([user_id, token]) => ({ user_id, token })));

describe("isPushable", () => {
  it("interrupts for work arriving and work closing", () => {
    expect(isPushable("task_assigned")).toBe(true);
    expect(isPushable("checklist_assigned")).toBe(true);
    expect(isPushable("project_assigned")).toBe(true);
    expect(isPushable("photo_comment_mention")).toBe(true);
    expect(isPushable("task_completed")).toBe(true);
  });

  it("does not interrupt for being copied in or broadcast at", () => {
    /*
     * Push is the most expensive channel the product has in goodwill terms, and
     * the fastest way to have it switched off is to spend it on things that
     * could have waited. Both of these belong in the inbox.
     */
    expect(isPushable("task_watching")).toBe(false);
    expect(isPushable("admin_announcement")).toBe(false);
  });

  it("does not push a type it has never heard of", () => {
    // The column is plain text upstream. Defaulting an unknown type to pushable
    // means the next type somebody adds buzzes every phone before anyone has
    // decided it should.
    expect(isPushable("invoice_overdue")).toBe(false);
    expect(isPushable("")).toBe(false);
  });
});

describe("expoMessagesFor", () => {
  it("sends to every device a person has registered", () => {
    // A phone and a tablet is normal and both should ring.
    const messages = expoMessagesFor(
      [row()],
      devices(["u1", "ExponentPushToken[phone]"], ["u1", "ExponentPushToken[tablet]"]),
    );
    expect(messages.map((m) => m.to)).toEqual([
      "ExponentPushToken[phone]",
      "ExponentPushToken[tablet]",
    ]);
  });

  it("produces nothing for somebody with no device", () => {
    // Which is why the caller still has to stamp the row: otherwise every
    // future sweep reconsiders it forever.
    expect(expoMessagesFor([row()], devices())).toEqual([]);
  });

  it("skips a type that is not worth interrupting for", () => {
    expect(
      expoMessagesFor([row({ type: "task_watching" })], devices(["u1", "ExponentPushToken[a]"])),
    ).toEqual([]);
  });

  it("carries exactly the notification's own columns as data", () => {
    /*
     * The whole contract with the app. `readPushData` reads these and hands
     * them to `notificationTarget`, which is the same function the inbox uses.
     * Anything invented here would be a second routing scheme that could
     * disagree with the first.
     */
    const [message] = expoMessagesFor([row()], devices(["u1", "ExponentPushToken[a]"]));
    expect(message.data).toEqual({
      type: "task_assigned",
      linkPath: "/projects/p1?task=t1",
      projectId: "p1",
      entityType: "task",
      entityId: "t1",
    });
  });

  it("omits empty fields rather than sending the string 'null'", () => {
    // What a naive `String(value)` produces, and what the app would then try to
    // route to.
    const [message] = expoMessagesFor(
      [row({ link_path: null, project_id: null, entity_type: null, entity_id: null })],
      devices(["u1", "ExponentPushToken[a]"]),
    );
    expect(message.data).toEqual({ type: "task_assigned" });
    expect(Object.values(message.data)).not.toContain("null");
  });

  it("omits a blank body rather than sending an empty second line", () => {
    const [message] = expoMessagesFor(
      [row({ body: "   " })],
      devices(["u1", "ExponentPushToken[a]"]),
    );
    expect(message.body).toBeUndefined();
  });

  it("trims a body that has one", () => {
    const [message] = expoMessagesFor(
      [row({ body: "  Assigned by Sam  " })],
      devices(["u1", "ExponentPushToken[a]"]),
    );
    expect(message.body).toBe("Assigned by Sam");
  });

  it("wakes a dozing phone for an assignment and not for a completion", () => {
    /*
     * On Android `high` wakes the device and `default` may be held to the next
     * maintenance window. Being given work needs to arrive now; being told work
     * closed does not.
     */
    const assigned = expoMessagesFor([row()], devices(["u1", "ExponentPushToken[a]"]));
    const completed = expoMessagesFor(
      [row({ type: "task_completed" })],
      devices(["u1", "ExponentPushToken[a]"]),
    );
    expect(assigned[0].priority).toBe("high");
    expect(completed[0].priority).toBe("default");
  });

  it("is silent, on every message", () => {
    // Four phones within earshot on one site, all with the app.
    const [message] = expoMessagesFor([row()], devices(["u1", "ExponentPushToken[a]"]));
    expect(message.sound).toBeNull();
    expect(message.channelId).toBe("default");
  });

  it("does not send one person's notification to another person's device", () => {
    const messages = expoMessagesFor(
      [row({ recipient_id: "u1" })],
      devices(["u2", "ExponentPushToken[theirs]"]),
    );
    expect(messages).toEqual([]);
  });
});

describe("devicesByUser", () => {
  it("groups by owner", () => {
    const map = devices(["u1", "ExponentPushToken[a]"], ["u2", "ExponentPushToken[b]"]);
    expect(map.get("u1")).toHaveLength(1);
    expect(map.get("u2")).toHaveLength(1);
  });

  it("drops a malformed token before it can poison a batch", () => {
    /*
     * Expo rejects the **whole batch** on one bad token rather than the single
     * message, so one junk row would stop every other notification in the same
     * sweep from being delivered.
     */
    const map = devices(["u1", "not a token"], ["u1", ""], ["u1", "ExponentPushToken[good]"]);
    expect(map.get("u1")).toHaveLength(1);
    expect(map.get("u1")![0].token).toBe("ExponentPushToken[good]");
  });
});

describe("isExpoToken", () => {
  it("accepts both spellings Expo has used", () => {
    expect(isExpoToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoToken("ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
  });

  it("rejects obvious junk", () => {
    expect(isExpoToken("")).toBe(false);
    expect(isExpoToken("not a token")).toBe(false);
    expect(isExpoToken("short")).toBe(false);
  });
});

describe("batches", () => {
  it("splits at Expo's hard cap", () => {
    // Expo rejects an over-long request outright rather than truncating it, so
    // this is a limit and not a tuning knob.
    const items = Array.from({ length: 250 }, (_, i) => i);
    const out = batches(items);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(EXPO_BATCH_SIZE);
    expect(out[2]).toHaveLength(50);
  });

  it("is empty for nothing", () => {
    expect(batches([])).toEqual([]);
  });

  it("does not lose items to a nonsense size", () => {
    expect(batches([1, 2, 3], 0).flat()).toEqual([1, 2, 3]);
  });
});

describe("tokensToDrop", () => {
  const message = (to: string): ExpoMessage => ({
    to,
    title: "t",
    data: {},
    channelId: "default",
    sound: null,
    priority: "default",
  });

  it("drops a token Expo says is gone", () => {
    const messages = [message("A"), message("B")];
    const tickets = [
      { status: "ok" },
      { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
    ];
    expect(tokensToDrop(messages, tickets)).toEqual(["B"]);
  });

  it("keeps a token that failed for any other reason", () => {
    // A rate limit or a transient Expo fault is not a dead device, and deleting
    // the token would silently unsubscribe somebody.
    const tickets = [{ status: "error", details: { error: "MessageRateExceeded" } }];
    expect(tokensToDrop([message("A")], tickets)).toEqual([]);
  });

  it("refuses to pair a response of the wrong length", () => {
    /*
     * Expo's response is positional: ticket n belongs to message n. A length
     * mismatch means something unexpected came back, and pairing anyway would
     * delete a working token because a different one failed.
     */
    const messages = [message("A"), message("B")];
    expect(
      tokensToDrop(messages, [{ status: "error", details: { error: "DeviceNotRegistered" } }]),
    ).toEqual([]);
    expect(tokensToDrop(messages, [])).toEqual([]);
  });

  it("deduplicates a token that failed several times in one batch", () => {
    // Normal when somebody has several notifications waiting.
    const messages = [message("A"), message("A")];
    const tickets = [
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ];
    expect(tokensToDrop(messages, tickets)).toEqual(["A"]);
  });

  it("survives a ticket with no details at all", () => {
    expect(tokensToDrop([message("A")], [{}])).toEqual([]);
  });
});
