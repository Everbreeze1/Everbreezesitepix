import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Trash2, AtSign, MessageSquare } from "lucide-react";
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
import { formatRelativeTime } from "@/lib/format-time";
import { useAssignableTeammates } from "@/hooks/use-assignable-teammates";
import {
  useReportPanelCount,
  usePanelIsActive,
} from "@/features/photos/components/PhotoDetailsPanel";

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

/**
 * What to call a teammate in the mention list, and what to type into the
 * message when one is picked.
 *
 * A profile with no full name used to fall back to the whole address, so the
 * list read as data and the inserted handle came out "@marklagura223@gmail.com"
 * - which `renderBodyWithMentions` cannot even match past the second @, so it
 * did not highlight either. The part before the @ is a name people recognise.
 */
function mentionName(c: CommentContributor): string {
  if (c.fullName) return c.fullName;
  if (c.email) return c.email.split("@")[0];
  return "Teammate";
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

  /*
   * @ offers the whole crew, not only the people who have already uploaded
   * something to this project. `contributors` counts activity; the roster is
   * what "teammate" means. See use-assignable-teammates.ts.
   */
  const { teammates, isLoading: teammatesLoading } = useAssignableTeammates(contributors);
  const mentionable = teammates;
  const mentionablePending = contributorsLoading || teammatesLoading;

  useReportPanelCount("comments", comments.length);
  const visible = usePanelIsActive("comments");

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

  /*
   * Auto-scroll to the newest message. `visible` is in the dependency list
   * because the tab stays mounted while it is off screen - a hidden element has
   * no scroll height, so a message that arrived on another tab would otherwise
   * leave the list parked at the top the next time Comments is opened.
   */
  useEffect(() => {
    if (!visible) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments.length, loading, visible]);

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
    return mentionable
      .filter((c) => c.userId !== currentUserId)
      .filter((c) => {
        if (!q) return true;
        const n = (c.fullName ?? c.email ?? "").toLowerCase();
        return n.includes(q);
      })
      .slice(0, 6);
  }, [mentionQuery, mentionable, currentUserId]);

  const insertMention = (c: CommentContributor) => {
    const handle = mentionName(c).split(/\s+/)[0] || "teammate";
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

  // No heading here - PhotoDetailsPanel's tab strip already says "Comments"
  // and carries the count.
  return (
    <div className="flex h-full min-h-0 w-full flex-col text-sidebar-foreground">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-sidebar-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-sidebar-border px-4 py-10 text-center">
            <MessageSquare className="h-5 w-5 text-sidebar-foreground/30" />
            <p className="text-xs text-sidebar-foreground/55">
              No messages yet.
              <br />
              Start the conversation for this photo.
            </p>
          </div>
        ) : (
          comments.map((c) => {
            const name = displayName(c);
            const mine = c.authorId === currentUserId;
            return (
              <div key={c.id} className="group flex items-start gap-2">
                <Avatar className="h-7 w-7 shrink-0">
                  {c.authorAvatarUrl ? <AvatarImage src={c.authorAvatarUrl} alt={name} /> : null}
                  <AvatarFallback className="bg-sidebar-foreground/15 text-[10px] text-sidebar-foreground">
                    {initials(name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 text-[11px]">
                    <span className="font-medium text-sidebar-foreground/90">
                      {mine ? "You" : name}
                    </span>
                    <span className="text-sidebar-foreground/40">
                      {formatRelativeTime(c.createdAt)}
                    </span>
                  </div>
                  <div
                    className={`mt-1 whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      mine
                        ? "rounded-tl-sm bg-primary/20 text-sidebar-foreground"
                        : "rounded-tl-sm bg-sidebar-accent text-sidebar-foreground/95"
                    }`}
                  >
                    {renderBodyWithMentions(c.body)}
                  </div>
                </div>
                {mine && (
                  <button
                    type="button"
                    aria-label="Delete comment"
                    onClick={() => del(c.id)}
                    className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-sidebar-foreground/40 opacity-0 transition-opacity hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Composer, pinned to the bottom edge of the tab. */}
      <div className="relative mt-3 shrink-0 border-t border-sidebar-border pt-3">
        {/* `dark` on the menu below, for the same reason as the assignee
            picker's popover: it is the app's floating-menu surface, resolved
            dark so it sits on the viewer's fixed navy chrome in either app
            theme. */}
        {mentionQuery !== null &&
          (mentionMatches.length > 0 || mentionablePending || mentionable.length === 0) && (
            <div className="dark absolute bottom-full left-0 z-10 mb-1.5 w-64 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Mention teammate
              </div>
              {mentionablePending && mentionable.length === 0 && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading teammates…
                </div>
              )}
              {!(mentionablePending && mentionable.length === 0) && mentionMatches.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  {mentionable.length === 0
                    ? "No teammates yet. Invite your crew from the Teams page."
                    : "No teammates match"}
                </div>
              )}
              {mentionMatches.map((c) => {
                const name = mentionName(c);
                return (
                  <button
                    key={c.userId}
                    type="button"
                    onClick={() => insertMention(c)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Avatar className="h-6 w-6">
                      {c.avatarUrl ? <AvatarImage src={c.avatarUrl} alt={name} /> : null}
                      <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
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
            className="min-h-[42px] flex-1 resize-none border-sidebar-border bg-sidebar-accent text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus-visible:ring-sidebar-ring"
          />
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-9 w-9 border border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-foreground/15"
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
