import { AI_TIMEOUT_MS } from "@everlumen/api-client";
import { randomUUID } from "expo-crypto";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, Conversation } from "./assistant-view";

/**
 * The AI assistant.
 *
 * A field supervisor to ask questions of, which is worth more standing in front
 * of a plant room than sitting at a desk - and the phone was the client that
 * could not reach it.
 *
 * Asking goes through `/v1/rpc`: the service holds the system prompt, reads the
 * thread's history, spends money on our Gemini key and enforces the plan gate.
 * Reading the history back is a direct RLS query, because `conversations` and
 * `messages` are own-user scoped with no team sharing anywhere in the product
 * (`supabase/migrations/20260811003000_restore_missing_tables.sql`), so there is
 * nothing for an API layer to decide.
 */

export type { ChatMessage, Conversation } from "./assistant-view";

export type AssistantReply = { conversationId: string; reply: string };

export async function askAssistant(input: {
  message: string;
  conversationId?: string;
  title?: string;
}): Promise<AssistantReply> {
  const result = await api.rpc<Partial<AssistantReply>>(
    "chatWithAssistant",
    {
      message: input.message.trim(),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.title ? { title: input.title } : {}),
    },
    /*
     * A fresh key per send, matching `createTaskComment`.
     *
     * The op is registered idempotent, and it needs to be: every call writes
     * two rows and spends money on the AI key, so a retry after a dropped
     * response would double-charge and leave the thread with the same question
     * asked twice. Fresh rather than derived from the text, because asking the
     * same question twice on purpose is a legitimate thing to do.
     */
    { idempotencyKey: randomUUID(), timeoutMs: AI_TIMEOUT_MS },
  );

  if (!result.conversationId || typeof result.reply !== "string") {
    throw new Error("The assistant replied with nothing.");
  }
  return { conversationId: result.conversationId, reply: result.reply };
}

/**
 * The most recent thread, or null.
 *
 * Opening the screen into the last conversation rather than a blank one is the
 * difference between a tool and a novelty: most follow-up questions are follow
 * ups, and losing the thread on every launch makes people re-explain the job
 * every time.
 */
export async function latestConversation(): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from("conversations" as never)
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Conversation | null) ?? null;
}

export async function listConversations(limit = 20): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("conversations" as never)
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as Conversation[] | null) ?? [];
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages" as never)
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    // The service feeds the model the last 40 turns, so showing more than that
    // would display context the assistant itself can no longer see.
    .limit(40);
  if (error) throw new Error(error.message);
  return (data as ChatMessage[] | null) ?? [];
}
