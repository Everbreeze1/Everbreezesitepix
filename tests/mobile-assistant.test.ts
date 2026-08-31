import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assistantFailure,
  canRetry,
  derivedTitle,
  inOrder,
  isFromUser,
  MAX_MESSAGE_LENGTH,
  messageError,
  threadSummary,
  TITLE_LENGTH,
  type ChatMessage,
} from "../apps/mobile/src/api/assistant-view";

/*
 * The AI assistant on the phone.
 *
 * Worth more standing in front of a plant room than at a desk, and the phone was
 * the one client that could not reach it.
 *
 * The rules that earn a test are the failure wording and the retry decision.
 * Gemini is geo-blocked on some networks, so failing is a real field condition
 * rather than a bug, and two of the failures will fail identically forever - a
 * retry button on those wastes somebody's time twice.
 */

const turn = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1",
  role: "user",
  content: "What should I check first?",
  created_at: "2026-08-31T09:00:00Z",
  ...over,
});

describe("messageError", () => {
  it("refuses an empty question", () => {
    expect(messageError("")).toContain("Ask something");
    expect(messageError("   \n ")).toContain("Ask something");
  });

  it("mirrors the ceiling the registry enforces", () => {
    expect(messageError("x".repeat(MAX_MESSAGE_LENGTH))).toBeNull();
    expect(messageError("x".repeat(MAX_MESSAGE_LENGTH + 4))).toContain("4 characters too long");
  });

  it("measures the trimmed message, the way the schema does", () => {
    expect(messageError(`  ${"x".repeat(MAX_MESSAGE_LENGTH)}  `)).toBeNull();
  });
});

describe("derivedTitle", () => {
  it("names a thread after what was asked", () => {
    // A list of threads all called "Untitled" is a list nobody opens twice.
    expect(derivedTitle("Why is the riser tripping?")).toBe("Why is the riser tripping?");
  });

  it("cuts on a word boundary rather than mid-word", () => {
    /*
     * The server would do `message.slice(0, 60)`, which cuts wherever it lands.
     * Sending a tidier title costs nothing and is the difference between a list
     * of readable threads and a list of fragments.
     */
    const long =
      "The riser on the third floor keeps tripping the breaker whenever the pump starts up";
    const title = derivedTitle(long);
    expect(title.length).toBeLessThanOrEqual(TITLE_LENGTH);
    expect(long).toContain(title);
    expect(title).not.toMatch(/\s$/);
  });

  it("collapses whitespace, so a pasted question does not become a ragged title", () => {
    expect(derivedTitle("What   is\n\nthis part?")).toBe("What is this part?");
  });

  it("never returns an empty title", () => {
    expect(derivedTitle("")).toBe("New question");
    expect(derivedTitle("   ")).toBe("New question");
  });

  it("stays within what the server would have produced", () => {
    const title = derivedTitle("x".repeat(500));
    expect(title.length).toBeLessThanOrEqual(TITLE_LENGTH);
  });
});

describe("inOrder", () => {
  it("reads oldest first, which is how a conversation reads", () => {
    const rows = [
      turn({ id: "b", created_at: "2026-08-31T10:00:00Z" }),
      turn({ id: "a", created_at: "2026-08-31T09:00:00Z" }),
    ];
    expect(inOrder(rows).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("sorts the in-flight turn against saved ones", () => {
    /*
     * The reason this is not left to the query. The optimistic turn shown while
     * the model thinks has a timestamp minted on the device, and it has to sort
     * correctly against timestamps minted on the server.
     */
    const rows = [
      turn({ id: "saved", created_at: "2026-08-31T09:00:00Z" }),
      turn({ id: "pending", created_at: "2026-08-31T09:05:00Z" }),
    ];
    expect(inOrder(rows).map((m) => m.id)).toEqual(["saved", "pending"]);
  });

  it("does not mutate what it was given", () => {
    const rows = [
      turn({ id: "b", created_at: "2026-08-31T10:00:00Z" }),
      turn({ id: "a", created_at: "2026-08-31T09:00:00Z" }),
    ];
    inOrder(rows);
    expect(rows.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("isFromUser", () => {
  it("splits the two sides of the thread", () => {
    expect(isFromUser(turn({ role: "user" }))).toBe(true);
    expect(isFromUser(turn({ role: "assistant" }))).toBe(false);
    // The column is plain text, so an unknown role draws as the assistant
    // rather than being mistaken for something the person said.
    expect(isFromUser(turn({ role: "system" }))).toBe(false);
  });
});

describe("assistantFailure", () => {
  it("passes the provider's own message through", () => {
    /*
     * "Quota exceeded" and "blocked in your region" call for completely
     * different responses from the person reading them, so flattening both into
     * one house message would be less useful, not more polished.
     */
    expect(assistantFailure("Rate limit exceeded")).toBe("Rate limit exceeded");
  });

  it("has something to say when there is no message at all", () => {
    expect(assistantFailure(null)).toContain("could not answer");
  });

  it("keeps the plan refusal verbatim, because it tells you what to do", () => {
    const pro = "Attaching photos to the AI is a Pro feature. Upgrade to Pro for vision chat.";
    expect(assistantFailure(pro)).toBe(pro);
  });

  it("rewords the unconfigured case, which is not the reader's problem", () => {
    expect(assistantFailure("AI is not configured")).toContain("not set up for this workspace");
  });
});

describe("canRetry", () => {
  it("offers a retry for a transient failure", () => {
    // Geo-blocking, a timeout, a rate limit: all worth one more try.
    expect(canRetry("Rate limit exceeded")).toBe(true);
    expect(canRetry(null)).toBe(true);
  });

  it("does not offer one for a failure that will never change", () => {
    /*
     * An unconfigured key and a plan refusal fail identically every time. A
     * retry button on those wastes somebody's time twice and teaches them the
     * button does nothing.
     */
    expect(canRetry("AI is not configured")).toBe(false);
    expect(canRetry("Attaching photos to the AI is a Pro feature.")).toBe(false);
  });
});

describe("threadSummary", () => {
  it("says what to ask before anything has been asked", () => {
    expect(threadSummary([])).toContain("Ask about a job");
  });

  it("counts questions, not turns", () => {
    // The assistant's replies are not questions, and counting them would double
    // every number on the screen.
    const rows = [turn({ role: "user" }), turn({ id: "2", role: "assistant" })];
    expect(threadSummary(rows)).toBe("1 question in this thread");
  });
});

describe("the phone and the server agree", () => {
  const registry = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/rpc/registry.ts"), "utf8");
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/ai/service.ts"), "utf8");
  const client = () =>
    readFileSync(join(process.cwd(), "apps/mobile/src/api/assistant.ts"), "utf8");

  it("mirrors the message bounds the registry enforces", () => {
    /*
     * `chatWithAssistant` declares its schema INLINE in the registry rather than
     * as a named `*InputSchema`, which means
     * `tests/mobile-rpc-request-shapes.test.ts` does not cover it - that test
     * maps ops to schemas through `xInputSchema.parse`. So the bounds are
     * checked here by hand instead.
     */
    const at = registry().indexOf("chatWithAssistant: authed(");
    const block = registry().slice(at, at + 500);
    expect(block).toContain(`max(${MAX_MESSAGE_LENGTH})`);
    expect(block).toContain("min(1)");
    expect(block).toContain("message:");
    expect(client()).toContain("message:");
  });

  it("sends an idempotency key, because the op is registered idempotent", () => {
    /*
     * Load-bearing: every call writes two rows and spends money on the AI key,
     * so a retry after a dropped response would double-charge and leave the
     * thread with the same question in it twice.
     */
    const at = registry().indexOf("chatWithAssistant: authed(");
    expect(registry().slice(at, at + 500)).toContain("idempotent: true");
    expect(client()).toContain("idempotencyKey");
  });

  it("reads back the two fields the service returns", () => {
    expect(service()).toContain("return { conversationId: convId, reply };");
    const c = client();
    expect(c).toContain("result.conversationId");
    expect(c).toContain("result.reply");
  });

  it("titles a thread the way the server would have", () => {
    // `data.title ?? data.message.slice(0, 60)`. A client-sent title must not
    // be longer than the one saying nothing would have produced.
    expect(service()).toContain("data.title ?? data.message.slice(0, 60)");
    expect(TITLE_LENGTH).toBe(60);
  });

  it("reads history through RLS, which is own-user scoped", () => {
    /*
     * Not an API op, and that is a decision rather than an oversight:
     * `conversations` and `messages` are private to their author with no team
     * sharing anywhere in the product, so there is nothing for an API layer to
     * decide.
     */
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260811003000_restore_missing_tables.sql"),
      "utf8",
    );
    expect(migration).toContain("Users manage their own conversations");
    expect(migration).toContain("user_id = auth.uid()");
    expect(client()).toContain('from("conversations"');
  });

  it("shows no more history than the model itself is given", () => {
    // The service feeds it the last 40 turns. Showing more would display
    // context the assistant can no longer see, which reads as it forgetting.
    expect(service()).toContain(".limit(40)");
    expect(client()).toContain(".limit(40)");
  });
});
