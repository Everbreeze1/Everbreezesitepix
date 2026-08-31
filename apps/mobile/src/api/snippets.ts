import { api } from "@/lib/api";
import type { TextSnippet } from "./snippets-view";

/**
 * Saved blocks of reusable text.
 *
 * Four existing `/v1/rpc` ops the phone never called. They could not be direct
 * RLS writes: creating one has to resolve the caller's team first, because a
 * snippet is team-shared when there is a team and personal when there is not,
 * and that lookup is the difference between a library the crew shares and one
 * only its author can see.
 *
 * Not queued through the outbox, for the same reason the team screens are not:
 * managing a library is desk work rather than field work, done deliberately and
 * rarely. A snippet that silently saved itself twenty minutes later when signal
 * returned would be a surprise, not a service.
 */

export type { TextSnippet } from "./snippets-view";

export async function listTextSnippets(): Promise<TextSnippet[]> {
  const result = await api.rpc<{ snippets?: TextSnippet[] }>("listTextSnippets");
  return result.snippets ?? [];
}

export async function createTextSnippet(input: {
  title: string;
  contentHtml: string;
}): Promise<TextSnippet> {
  const result = await api.rpc<{ snippet: TextSnippet }>("createTextSnippet", {
    title: input.title.trim(),
    contentHtml: input.contentHtml,
  });
  return result.snippet;
}

export async function updateTextSnippet(input: {
  snippetId: string;
  title?: string;
  contentHtml?: string;
}): Promise<void> {
  await api.rpc("updateTextSnippet", {
    snippetId: input.snippetId,
    // Omitted rather than sent as undefined: the service patches only the keys
    // it is given, so sending a key at all is what decides it gets written.
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(input.contentHtml === undefined ? {} : { contentHtml: input.contentHtml }),
  });
}

export async function deleteTextSnippet(snippetId: string): Promise<void> {
  await api.rpc("deleteTextSnippet", { snippetId });
}
