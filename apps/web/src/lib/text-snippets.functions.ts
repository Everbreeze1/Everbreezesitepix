import { rpcOp } from "./sitepix-api";

export interface TextSnippet {
  id: string;
  title: string;
  content_html: string;
  created_at: string;
}

export const listTextSnippets = rpcOp<undefined, { snippets: TextSnippet[] }>("listTextSnippets");

export const createTextSnippet = rpcOp<{ title: string; contentHtml: string }, { snippet: TextSnippet }>(
  "createTextSnippet",
);

export const updateTextSnippet = rpcOp<
  { snippetId: string; title?: string; contentHtml?: string },
  { ok: true }
>("updateTextSnippet");

export const deleteTextSnippet = rpcOp<{ snippetId: string }, { ok: true }>("deleteTextSnippet");
