import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  ShieldAlert,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/use-confirm";
import { formatRelativeTime } from "@/lib/format-time";
import {
  addTaskWatchers,
  appOrigin,
  createTaskComment,
  deleteTaskComment,
  listTaskCollaboration,
  removeTaskWatcher,
  type TaskComment,
  type TaskWatcher,
} from "@/lib/tasks.functions";

export interface CollaborationMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string | null;
  /** False when they have not confirmed their address and cannot sign in yet. */
  emailConfirmed?: boolean | null;
}

interface Props {
  taskId: string;
  /** Who can be looped in: the roster this panel's parent already loaded. */
  members: CollaborationMember[];
  currentUserId: string;
  /** Excluded from the watcher picker - they already get every message. */
  assigneeUserId: string | null;
}

const nameOf = (m: { full_name: string | null; email: string | null } | undefined | null) =>
  m?.full_name || m?.email || "Member";

/**
 * The token typed into a message when a teammate is picked from the @ list.
 *
 * One word, and never a whole address. `renderBodyWithMentions` in the photo
 * thread cannot match past the second @, so "@mark@example.com" highlights
 * nothing; the part before the @ is also the name people actually recognise.
 * Kept identical in shape to `mentionName` in PhotoCommentsPanel so a mention
 * reads the same in both threads.
 */
const mentionHandle = (m: { full_name: string | null; email: string | null }) => {
  const name = m.full_name?.trim() || m.email?.split("@")[0] || "teammate";
  return name.split(/\s+/)[0];
};

/**
 * Highlight the @handles in a posted message.
 *
 * Presentational only. Who was actually notified is the `mentions` array on the
 * row, not whatever matches this regex - somebody typing "@bob" about a person
 * who is not on the team highlights and reaches nobody, which is the correct
 * outcome for both.
 */
function renderWithMentions(body: string): React.ReactNode {
  return body.split(/(@[\w.-]+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="rounded bg-primary/15 px-1 font-semibold text-foreground">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function initials(name: string | null, email: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/** Human label for a stored team role, matching the Settings roster. */
const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  standard: "Standard",
  member: "Standard",
  restricted: "Restricted",
};

/**
 * The CC line and the thread.
 *
 * Two of the client's gaps live here, and they are the same gap twice: a task
 * could be handed to exactly one person, and after that nothing about it could
 * reach anybody else.
 *
 *   "You can't loop in a second person (e.g., assign to a tech but keep the
 *    office manager on the task)."
 *
 *   "There's nowhere to leave a note like 'waiting on part' or ask a question
 *    without editing the description field, which overwrites rather than logs."
 *
 * A watcher holds no work and cannot close anything - `completionRights` is
 * untouched by this file. What they get is every message the task generates,
 * which is the whole of what "keep the office manager on it" means.
 *
 * A comment is a message with an author and a time. The description stays what
 * it is: a statement of the job, which is a thing you edit. "Waiting on part"
 * is a thing you said, which is a thing you append.
 *
 * Loaded on mount rather than lazily behind a tab: a thread you have to ask for
 * is a thread nobody reads, and the whole point of the feature is that the
 * conversation is visible next to the work.
 */
export function TaskCollaboration({ taskId, members, currentUserId, assigneeUserId }: Props) {
  const confirm = useConfirm();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [watchers, setWatchers] = useState<TaskWatcher[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [addingWatchers, setAddingWatchers] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** The @ query under the caret, or null when the caret is not in one. */
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  /** Teammates picked from the @ list, filtered again at send time. */
  const [mentioned, setMentioned] = useState<Set<string>>(new Set());
  const threadEnd = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);

  const load = async () => {
    try {
      const res = await listTaskCollaboration({ data: { taskId } });
      setComments(res.comments);
      setWatchers(res.watchers);
    } catch (e: any) {
      // A workspace whose SQL migration has not been applied yet answers "does
      // not exist". Every other panel in this project treats that as "the
      // feature is not there", not as an error a crew member can act on.
      if (!String(e?.message ?? "").includes("does not exist")) {
        toast.error(e?.message ?? "Could not load the task thread");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [taskId]);

  const watcherIds = useMemo(() => new Set(watchers.map((w) => w.userId)), [watchers]);

  const memberById = useMemo(() => {
    const m = new Map<string, CollaborationMember>();
    members.forEach((x) => m.set(x.user_id, x));
    return m;
  }, [members]);

  /**
   * Who is left to add.
   *
   * The assignee is excluded rather than shown as already-watching: they are
   * not a watcher, they hold the task, and every message reaches them through
   * that. Offering to CC the person the work belongs to invites a duplicate
   * that the notification triggers would then have to suppress.
   */
  const addable = useMemo(
    () => members.filter((m) => !watcherIds.has(m.user_id) && m.user_id !== assigneeUserId),
    [members, watcherIds, assigneeUserId],
  );

  /**
   * The roles with somebody addable in them, for "add the whole crew".
   *
   * The client: "as the crew grows, one-by-one dropdown assignment won't scale
   * to 'assign all HVAC installs to the HVAC team'." A task still has exactly
   * one assignee - splitting accountability is not a fix for anything - but the
   * people who need to KNOW are a group, and that is what this adds in one
   * press.
   */
  const addableRoles = useMemo(() => {
    const byRole = new Map<string, CollaborationMember[]>();
    for (const m of addable) {
      const role = m.role ?? "standard";
      byRole.set(role, [...(byRole.get(role) ?? []), m]);
    }
    return [...byRole.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [addable]);

  const addWatchers = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    setAddingWatchers(true);
    setPickerOpen(false);
    try {
      await addTaskWatchers({ data: { taskId, userIds, origin: appOrigin() } });
      await load();
      const who =
        userIds.length === 1
          ? nameOf(members.find((m) => m.user_id === userIds[0]))
          : `${userIds.length} people`;
      toast.success(`${who} will be notified about this task`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add to this task");
    } finally {
      setAddingWatchers(false);
    }
  };

  const dropWatcher = async (w: TaskWatcher) => {
    const before = watchers;
    setWatchers((arr) => arr.filter((x) => x.userId !== w.userId));
    try {
      await removeTaskWatcher({ data: { taskId, userId: w.userId } });
    } catch (e: any) {
      setWatchers(before);
      toast.error(e?.message ?? "Could not remove them");
    }
  };

  /* ------------------------------------------------------------- mentions */

  /**
   * The @ query the caret is currently sitting in, or null.
   *
   * Read from the text before the cursor rather than from the whole draft, so
   * going back to fix a word in the middle of a sentence does not reopen the
   * picker on an @handle typed earlier.
   */
  const handleDraftChange = (v: string) => {
    setDraft(v);
    const cursor = composer.current?.selectionStart ?? v.length;
    const m = v.slice(0, cursor).match(/(?:^|\s)@([\w.-]*)$/);
    setMentionQuery(m ? m[1].toLowerCase() : null);
  };

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    return members
      .filter((m) => m.user_id !== currentUserId)
      .filter((m) => !mentionQuery || nameOf(m).toLowerCase().includes(mentionQuery))
      .slice(0, 6);
  }, [mentionQuery, members, currentUserId]);

  const insertMention = (m: CollaborationMember) => {
    const handle = mentionHandle(m);
    const cursor = composer.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, cursor).replace(/@[\w.-]*$/, `@${handle} `);
    const next = before + draft.slice(cursor);
    setDraft(next);
    setMentionQuery(null);
    setMentioned((prev) => new Set(prev).add(m.user_id));
    requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(before.length, before.length);
    });
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    /*
     * Only the people still named in the message.
     *
     * `mentioned` accumulates as handles are picked, and picking one then
     * deleting the text would otherwise notify somebody whose name is nowhere
     * in what was actually sent - a "mentioned you" pointing at a sentence that
     * does not mention them.
     */
    const mentions = [...mentioned].filter((id) => {
      const m = memberById.get(id);
      return m ? body.includes(`@${mentionHandle(m)}`) : false;
    });
    setSending(true);
    try {
      const res = await createTaskComment({
        data: { taskId, body, mentions, origin: appOrigin() },
      });
      setComments((arr) => [...arr, res.comment]);
      setDraft("");
      setMentioned(new Set());
      setMentionQuery(null);
      requestAnimationFrame(() => threadEnd.current?.scrollIntoView({ block: "nearest" }));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not post that");
    } finally {
      setSending(false);
    }
  };

  const remove = async (c: TaskComment) => {
    if (!(await confirm({ description: "Delete this comment?", variant: "destructive" }))) return;
    const before = comments;
    setComments((arr) => arr.filter((x) => x.id !== c.id));
    try {
      await deleteTaskComment({ data: { commentId: c.id } });
    } catch (e: any) {
      setComments(before);
      toast.error(e?.message ?? "Could not delete that");
    }
  };

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------- watchers */}
      <div className="rounded-2xl border-[0.8px] border-border bg-muted/25 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-manrope text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            Also notified
            {watchers.length > 0 && (
              <span className="tabular-nums text-foreground">({watchers.length})</span>
            )}
          </div>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={addingWatchers || addable.length === 0}
                className="h-7 rounded-lg px-2.5 font-manrope text-[11px] font-bold"
              >
                {addingWatchers ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <UserPlus className="mr-1 h-3 w-3" />
                )}
                Add people
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-1.5" align="end">
              {addableRoles.length > 1 && (
                <div className="mb-1 border-b border-border pb-1.5">
                  <p className="px-2 py-1 font-manrope text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
                    Whole crew
                  </p>
                  {addableRoles.map(([role, list]) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => void addWatchers(list.map((m) => m.user_id))}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition hover:bg-muted"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Plus className="h-3 w-3 text-muted-foreground" />
                        Everyone with {ROLE_LABEL[role] ?? role}
                      </span>
                      <span className="tabular-nums text-[11px] text-muted-foreground">
                        {list.length}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="max-h-64 overflow-y-auto">
                {addable.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    Everyone on the team is already on this task.
                  </p>
                ) : (
                  addable.map((m) => (
                    <button
                      key={m.user_id}
                      type="button"
                      onClick={() => void addWatchers([m.user_id])}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted"
                    >
                      <Avatar className="h-5 w-5">
                        {m.avatar_url && <AvatarImage src={m.avatar_url} alt="" />}
                        <AvatarFallback className="text-[8px]">
                          {initials(m.full_name, m.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {nameOf(m)}
                      </span>
                      {/* The same warning the assignee field carries. Copying
                          somebody who cannot sign in is quieter than assigning
                          to them, but it is the same dead end. */}
                      {m.emailConfirmed === false && (
                        <ShieldAlert className="h-3 w-3 shrink-0 text-amber-500" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {watchers.length === 0 ? (
          <p className="mt-2 font-manrope text-xs leading-5 text-muted-foreground">
            Nobody else is copied in. Add the office, a second tech, or a whole role and they get
            every reassignment, completion and comment on this task.
          </p>
        ) : (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {watchers.map((w) => {
              const m = memberById.get(w.userId);
              return (
                <span
                  key={w.userId}
                  className="group inline-flex items-center gap-1.5 rounded-full border-[0.8px] border-border bg-card py-1 pl-1 pr-1.5 font-manrope text-[11px] font-bold"
                >
                  <Avatar className="h-4 w-4">
                    {(m?.avatar_url ?? w.avatarUrl) && (
                      <AvatarImage src={(m?.avatar_url ?? w.avatarUrl) as string} alt="" />
                    )}
                    <AvatarFallback className="text-[7px]">
                      {initials(w.fullName ?? m?.full_name ?? null, w.email ?? m?.email ?? null)}
                    </AvatarFallback>
                  </Avatar>
                  {w.fullName || w.email || nameOf(m)}
                  <button
                    type="button"
                    onClick={() => void dropWatcher(w)}
                    aria-label={`Stop notifying ${w.fullName || w.email || "them"}`}
                    className="rounded-full p-0.5 text-muted-foreground transition hover:bg-muted hover:text-destructive"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* --------------------------------------------------------- thread */}
      <div className="rounded-2xl border-[0.8px] border-border bg-muted/25 p-3.5">
        <div className="flex items-center gap-1.5 font-manrope text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          Activity
          {comments.length > 0 && (
            <span className="tabular-nums text-foreground">({comments.length})</span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <p className="mt-2 font-manrope text-xs leading-5 text-muted-foreground">
            No notes yet. Leave one here instead of editing the description - a note is logged with
            your name and the time, an edit just overwrites what the task used to say.
          </p>
        ) : (
          <ul className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
            {comments.map((c) => {
              const m = memberById.get(c.authorId);
              const avatar = c.authorAvatarUrl ?? m?.avatar_url ?? null;
              return (
                <li key={c.id} className="group flex gap-2.5">
                  <Avatar className="mt-0.5 h-6 w-6 shrink-0">
                    {avatar && <AvatarImage src={avatar} alt="" />}
                    <AvatarFallback className="text-[8px]">
                      {initials(c.authorName ?? m?.full_name ?? null, c.authorEmail)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-manrope text-xs font-extrabold text-foreground">
                        {c.authorName || c.authorEmail || nameOf(m)}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground">
                        {formatRelativeTime(c.createdAt)}
                      </span>
                      {c.authorId === currentUserId && (
                        <button
                          type="button"
                          onClick={() => void remove(c)}
                          aria-label="Delete comment"
                          className="ml-auto rounded p-0.5 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground/90">
                      {renderWithMentions(c.body)}
                    </p>
                  </div>
                </li>
              );
            })}
            <div ref={threadEnd} />
          </ul>
        )}

        {/* The @ list, above the composer rather than below it: the composer
            sits at the bottom of a dialog that is already scrolled, and a menu
            opening downwards from there opens off screen. */}
        {mentionQuery !== null && mentionMatches.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border-[0.8px] border-border bg-card shadow-sm">
            {mentionMatches.map((m) => (
              <button
                key={m.user_id}
                type="button"
                onClick={() => insertMention(m)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-muted"
              >
                <Avatar className="h-5 w-5">
                  {m.avatar_url && <AvatarImage src={m.avatar_url} alt="" />}
                  <AvatarFallback className="text-[8px]">
                    {initials(m.full_name, m.email)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{nameOf(m)}</span>
                <span className="shrink-0 text-[10.5px] text-muted-foreground">
                  @{mentionHandle(m)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-end gap-2">
          <Textarea
            ref={composer}
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={(e) => {
              /*
               * Enter sends, Shift+Enter breaks the line. A note is one or two
               * sentences typed on a phone, not a document.
               *
               * Except while the @ list is open, where Enter belongs to the
               * list - otherwise typing "@ma" and pressing Enter posts a
               * half-written handle instead of picking the teammate.
               */
              if (e.key === "Escape" && mentionQuery !== null) {
                e.preventDefault();
                setMentionQuery(null);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                if (mentionQuery !== null && mentionMatches.length > 0) {
                  e.preventDefault();
                  insertMention(mentionMatches[0]);
                  return;
                }
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Leave a note, e.g. waiting on part. Use @ to mention…"
            className="min-h-[44px] resize-none rounded-xl text-sm"
            aria-label="Add a note to this task"
          />
          <Button
            type="button"
            size="icon"
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
            aria-label="Post note"
            className="h-10 w-10 shrink-0 rounded-xl"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {/* Mentioning is a one-off "this needs you"; the CC line above is
            standing. Saying so here is what stops @ from being used as a way to
            add somebody and then wondering why they missed the next update. */}
        <p className="mt-1.5 text-[10.5px] leading-4 text-muted-foreground">
          Everyone on this task is notified: the assignee, whoever assigned it, and anyone copied in
          above. An @mention reaches that person once; use Add people to keep them on it.
        </p>
      </div>
    </div>
  );
}
