import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Trash2, AtSign } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/sitepix/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  listPhotoComments,
  createPhotoComment,
  getPhotoComment,
  deletePhotoComment,
  type PhotoComment,
} from "@/lib/photo-comments.functions";

export interface CommentContributor {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

interface Props {
  photoId: string;
  projectId: string;
  currentUserId: string;
  contributors: CommentContributor[];
  contributorsLoading?: boolean;
  onClose?: () => void;
}

function displayName(c: {
  authorName?: string | null;
  authorEmail?: string | null;
  fullName?: string | null;
  email?: string | null;
}): string {
  return (c.authorName ?? c.fullName ?? c.authorEmail ?? c.email ?? "Teammate") as string;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderBodyWithMentions(body: string): React.ReactNode {
  const parts = body.split(/(@[\w.-]+)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="rounded bg-sky-500/25 px-1 font-medium text-sky-200">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function PhotoCommentsPanel({
  photoId,
  projectId,
  currentUserId,
  contributors,
  contributorsLoading = false,
}: Props) {
  const [comments, setComments] = useState<PhotoComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentioned, setMentioned] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const list = listPhotoComments;
  const create = createPhotoComment;
  const getOne = getPhotoComment;
  const remove = deletePhotoComment;

  // Initial load + reset when the photo changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setComments([]);
    setBody("");
    setMentioned(new Set());
    setMentionQuery(null);
    list({ data: { photoId } })
      .then((res) => {
        if (!cancelled) setComments(res.comments);
      })
      .catch((e: any) => {
        if (!cancelled) toast.error(e?.message ?? "Failed to load comments");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [photoId, list]);

  // Realtime: listen for new comments on this photo (from teammates).
  useEffect(() => {
    const channel = supabase
      .channel(`photo-comments:${photoId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "photo_comments",
          filter: `photo_id=eq.${photoId}`,
        },
        async (payload: any) => {
          const id = payload?.new?.id;
          if (!id) return;
          // Skip if we already have it (from our own optimistic insert).
          setComments((prev) => (prev.some((c) => c.id === id) ? prev : prev));
          try {
            const { comment } = await getOne({ data: { commentId: id } });
            if (!comment) return;
            setComments((prev) => (prev.some((c) => c.id === id) ? prev : [...prev, comment]));
          } catch {
            // ignore
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "photo_comments",
          filter: `photo_id=eq.${photoId}`,
        },
        (payload: any) => {
          const id = payload?.old?.id;
          if (!id) return;
          setComments((prev) => prev.filter((c) => c.id !== id));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [photoId, getOne]);

  // Auto-scroll to bottom as new comments arrive.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments.length, loading]);

  // Detect @ query while typing.
  const handleBodyChange = (v: string) => {
    setBody(v);
    const cursor = textareaRef.current?.selectionStart ?? v.length;
    const upto = v.slice(0, cursor);
    const m = upto.match(/(?:^|\s)@([\w.-]*)$/);
    setMentionQuery(m ? m[1].toLowerCase() : null);
  };

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery;
    return contributors
      .filter((c) => c.userId !== currentUserId)
      .filter((c) => {
        if (!q) return true;
        const n = (c.fullName ?? c.email ?? "").toLowerCase();
        return n.includes(q);
      })
      .slice(0, 6);
  }, [mentionQuery, contributors, currentUserId]);

  const insertMention = (c: CommentContributor) => {
    const name = c.fullName ?? c.email ?? "teammate";
    const handle = name.split(/\s+/)[0] || "teammate";
    const cursor = textareaRef.current?.selectionStart ?? body.length;
    const before = body.slice(0, cursor).replace(/@[\w.-]*$/, `@${handle} `);
    const after = body.slice(cursor);
    const next = before + after;
    setBody(next);
    setMentionQuery(null);
    setMentioned((prev) => new Set(prev).add(c.userId));
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const pos = before.length;
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const { comment } = await create({
        data: {
          photoId,
          projectId,
          body: trimmed,
          mentions: Array.from(mentioned),
        },
      });
      setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
      setBody("");
      setMentioned(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to post");
    } finally {
      setSending(false);
    }
  };

  const del = async (id: string) => {
    const prev = comments;
    setComments((cs) => cs.filter((c) => c.id !== id));
    try {
      await remove({ data: { commentId: id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
      setComments(prev);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-white">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-white/70">
          Comments
          {comments.length > 0 && <span className="ml-1.5 text-white/50">· {comments.length}</span>}
        </div>
        <div className="text-[11px] text-white/50">Use @ to mention teammates</div>
      </div>

      <div
        ref={listRef}
        className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-2 pr-3"
      >
        {loading ? (
          <div className="flex items-center justify-center py-6 text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <p className="py-4 text-center text-xs text-white/50">
            No messages yet. Start the conversation for this photo.
          </p>
        ) : (
          comments.map((c) => {
            const name = displayName(c);
            const mine = c.authorId === currentUserId;
            return (
              <div key={c.id} className="group flex items-start gap-2">
                <Avatar className="h-7 w-7 shrink-0">
                  {c.authorAvatarUrl ? <AvatarImage src={c.authorAvatarUrl} alt={name} /> : null}
                  <AvatarFallback className="bg-white/15 text-[10px] text-white">
                    {initials(name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 text-[11px]">
                    <span className="font-medium text-white/90">{mine ? "You" : name}</span>
                    <span className="text-white/40">{formatTime(c.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap break-words rounded-md bg-white/10 px-2 py-1.5 text-sm text-white/95">
                    {renderBodyWithMentions(c.body)}
                  </div>
                </div>
                {mine && (
                  <button
                    type="button"
                    aria-label="Delete comment"
                    onClick={() => del(c.id)}
                    className="mt-1 hidden h-6 w-6 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white group-hover:flex"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="relative mt-2">
        {mentionQuery !== null &&
          (mentionMatches.length > 0 || contributorsLoading || contributors.length === 0) && (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-lg border border-white/10 bg-neutral-900 shadow-lg">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/50">
                Mention teammate
              </div>
              {contributorsLoading && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-white/60">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading teammates…
                </div>
              )}
              {!contributorsLoading && mentionMatches.length === 0 && (
                <div className="px-2 py-2 text-xs text-white/50">No teammates match</div>
              )}
              {mentionMatches.map((c) => {
                const name = c.fullName ?? c.email ?? "Teammate";
                return (
                  <button
                    key={c.userId}
                    type="button"
                    onClick={() => insertMention(c)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-white hover:bg-white/10"
                  >
                    <Avatar className="h-6 w-6">
                      {c.avatarUrl ? <AvatarImage src={c.avatarUrl} alt={name} /> : null}
                      <AvatarFallback className="bg-white/15 text-[10px] text-white">
                        {initials(name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{name}</span>
                  </button>
                );
              })}
            </div>
          )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => handleBodyChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !mentionQuery) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Write a message… use @ to mention"
            rows={2}
            className="min-h-[42px] flex-1 resize-none border-white/15 bg-white/5 text-sm text-white placeholder:text-white/40 focus-visible:ring-white/30"
          />
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-9 w-9 bg-white/10 text-white hover:bg-white/20"
              onClick={() => {
                setBody((b) =>
                  b.endsWith("@") || b.endsWith(" ") || b === "" ? b + "@" : b + " @",
                );
                setMentionQuery("");
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              aria-label="Mention teammate"
            >
              <AtSign className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              className="h-9 w-9"
              disabled={sending || body.trim().length === 0}
              onClick={() => void submit()}
              aria-label="Send message"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
