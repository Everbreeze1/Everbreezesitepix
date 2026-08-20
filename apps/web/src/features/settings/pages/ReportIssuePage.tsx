import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bug,
  Check,
  ChevronDown,
  Image as ImageIcon,
  Laptop,
  Lightbulb,
  Loader2,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { formatBytes } from "@/hooks/use-storage-usage";
import { supabase } from "@/integrations/sitepix/client";
import { cn } from "@/lib/utils";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  submitFeedback,
  uploadFeedbackAttachments,
  type FeedbackKind,
} from "@/lib/feedback";
import { clientContextRows, readClientContext, type ClientContext } from "@/lib/feedback-context";
import { projectDisplayName } from "@sitepix/shared";

/** The two things people actually come here to do. */
const MODES: Array<{
  kind: Extract<FeedbackKind, "bug" | "idea">;
  tab: string;
  icon: typeof Bug;
  banner: string;
  bannerHint: string;
  label: string;
  labelHint: string;
  placeholder: string;
  cta: string;
  thanks: string;
  thanksBody: string;
}> = [
  {
    kind: "bug",
    tab: "Report a problem",
    icon: Bug,
    banner: "A clear field note helps us move faster.",
    bannerHint: "Answer what you can. Your device details are filled in for you.",
    label: "What went wrong?",
    labelHint: "What you were trying to do, what happened instead, and how to see it again.",
    placeholder: "I tapped Generate report and it spun for a minute, then showed an error…",
    cta: "Send report",
    thanks: "Report sent",
    thanksBody:
      "Our team has been notified. If we need more detail we'll reply to the email on your account.",
  },
  {
    kind: "idea",
    tab: "Suggest a feature",
    icon: Lightbulb,
    banner: "Tell us what would make SitePix better.",
    bannerHint: "What are you doing by hand today that we could do for you?",
    label: "What would you like to see?",
    labelHint: "Describe the feature and what it would let you do.",
    placeholder: "It would save me an hour a week if…",
    cta: "Send suggestion",
    thanks: "Suggestion sent",
    thanksBody: "Every suggestion gets read, and they set what we build next.",
  },
];

const NO_PROJECT = "none";

interface ProjectOption {
  id: string;
  name: string;
}

/** Grows with the text instead of reserving six rows for a two-line answer. */
function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // Capped so a long report scrolls inside the field rather than pushing the
    // Send button off the bottom of the screen.
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [value]);
  return ref;
}

export function ReportIssuePage() {
  const { user } = useAuth();
  const [kind, setKind] = useState<"bug" | "idea">("bug");
  const [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState<string>(NO_PROJECT);
  const [files, setFiles] = useState<File[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<null | { kind: "bug" | "idea"; attachments: number }>(null);
  const [showDeviceDetails, setShowDeviceDetails] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useAutoGrow(message);

  const mode = MODES.find((m) => m.kind === kind)!;
  const sentMode = MODES.find((m) => m.kind === sent?.kind) ?? mode;

  /*
   * After mount, not during render. The app server-renders this route, and
   * `navigator`/`window.screen` do not exist there - reading them in a `useMemo`
   * would make the server's markup say "Unknown browser" where the client's
   * says "Chrome 141", which is a hydration mismatch. Read once, after the DOM
   * exists; none of it changes while the page is open.
   */
  const [client, setClient] = useState<ClientContext | null>(null);
  useEffect(() => setClient(readClientContext()), []);
  const deviceRows = useMemo(() => (client ? clientContextRows(client) : []), [client]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setProjects(
        ((data as ProjectOption[]) ?? []).map((p) => ({
          id: p.id,
          name: projectDisplayName(p),
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const addFiles = (picked: FileList | null) => {
    if (!picked?.length) return;
    const room = MAX_ATTACHMENTS - files.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    const chosen = Array.from(picked);
    const accepted: File[] = [];
    for (const file of chosen.slice(0, room)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(
          `${file.name} is ${formatBytes(file.size)}, over the ${formatBytes(
            MAX_ATTACHMENT_BYTES,
          )} limit.`,
        );
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
    if (chosen.length > room) {
      toast.error(`Only the first ${room} file${room === 1 ? "" : "s"} could be added.`);
    }
  };

  const resetForm = () => {
    setMessage("");
    setProjectId(NO_PROJECT);
    setFiles([]);
    setShowDeviceDetails(false);
  };

  const submit = async () => {
    if (!message.trim()) {
      toast.error(kind === "bug" ? "Please describe the issue." : "Please describe your idea.");
      textareaRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      let attachments: string[] = [];
      if (kind === "bug" && files.length && user?.id) {
        const result = await uploadFeedbackAttachments(user.id, files);
        attachments = result.paths;
        if (result.failed.length) {
          // The report still goes. Losing it because a screenshot would not
          // upload is the wrong trade.
          toast.error(`Couldn't attach ${result.failed.join(", ")} - sending the rest.`);
        }
      }

      await submitFeedback({
        kind,
        message,
        source: "page",
        userId: user?.id ?? null,
        email: user?.email ?? null,
        projectId: kind === "bug" && projectId !== NO_PROJECT ? projectId : null,
        client,
        attachments,
      });

      setSent({ kind, attachments: attachments.length });
      resetForm();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send that - try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const fieldLabel = "font-manrope text-sm font-extrabold text-foreground";
  const fieldHint = "font-manrope mt-1 text-xs leading-5 text-muted-foreground";

  return (
    <div className="px-5 py-8 md:px-10 md:py-10">
      {/*
        One column, capped and centred. On a wide monitor the form used to sit
        against the left edge of an otherwise empty page, which reads as
        unfinished rather than deliberate.
      */}
      <div className="mx-auto w-full max-w-[720px]">
        <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.52px] text-muted-foreground">
          Support
        </p>
        <h1 className="font-display mt-3 text-[38.4px] font-bold leading-9 tracking-[-1.34px] text-foreground">
          Share feedback
        </h1>
        <p className="font-manrope mt-3 text-sm leading-6 text-muted-foreground">
          Report something that&rsquo;s broken, or tell us what to build next. Both go straight to
          the team.
        </p>

        {sent ? (
          <SentPanel
            title={sentMode.thanks}
            body={sentMode.thanksBody}
            attachments={sent.attachments}
            onAgain={() => {
              setKind(sent.kind);
              setSent(null);
            }}
          />
        ) : (
          <>
            <div className="mt-6 inline-flex rounded-xl border border-border bg-card p-1">
              {MODES.map((m) => {
                const Icon = m.icon;
                const active = m.kind === kind;
                return (
                  <button
                    key={m.kind}
                    type="button"
                    onClick={() => setKind(m.kind)}
                    aria-pressed={active}
                    className={cn(
                      "font-manrope inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {m.tab}
                  </button>
                );
              })}
            </div>

            {/*
              One card, and it has to read as one: a solid fill on the wrapper,
              a tinted header that owns its own bottom border, and fields on
              `bg-background` so they sit inside the card rather than looking
              like a second one. The previous version tinted the header, drew a
              divider, then left the body on a translucent fill that matched the
              page, so it was unclear where the card ended.
            */}
            <div className="mt-5 overflow-hidden rounded-[24px] border border-border bg-card shadow-[0px_16px_32px_-28px_rgba(16,25,41,0.6)]">
              <div className="border-b border-border bg-muted/40 px-6 py-5">
                <p className="font-manrope text-sm font-extrabold text-foreground">{mode.banner}</p>
                <p className="font-manrope mt-1 text-xs text-muted-foreground">{mode.bannerHint}</p>
              </div>

              <div className="space-y-6 p-6">
                {kind === "bug" && (
                  <div>
                    <label htmlFor="feedback-project" className={fieldLabel}>
                      Which project?{" "}
                      <span className="font-bold text-muted-foreground">(optional)</span>
                    </label>
                    <p className={fieldHint}>
                      Only the project name is shared, so we can look in the right place. No photos,
                      documents, or notes are sent.
                    </p>
                    <Select value={projectId} onValueChange={setProjectId}>
                      <SelectTrigger
                        id="feedback-project"
                        className="mt-2 h-11 rounded-xl border-border bg-background text-sm"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_PROJECT}>Not about a specific project</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div>
                  <label htmlFor="feedback-message" className={fieldLabel}>
                    {mode.label}
                  </label>
                  <p className={fieldHint}>{mode.labelHint}</p>
                  <textarea
                    id="feedback-message"
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder={mode.placeholder}
                    className="font-manrope mt-2 min-h-[6rem] w-full resize-none overflow-y-auto rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                  {message.length > 3600 && (
                    <p className="font-manrope mt-1 text-right text-xs text-muted-foreground">
                      {4000 - message.length} characters left
                    </p>
                  )}
                </div>

                {kind === "bug" && (
                  <AttachmentField
                    files={files}
                    inputRef={fileInput}
                    onPick={addFiles}
                    onRemove={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                )}

                {/* Absent for the one frame between hydration and the effect above. */}
                {deviceRows.length > 0 && (
                  <DeviceField
                    rows={deviceRows}
                    open={showDeviceDetails}
                    onToggle={() => setShowDeviceDetails((v) => !v)}
                  />
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-5">
                  <Button
                    type="button"
                    onClick={() => void submit()}
                    disabled={submitting || !message.trim()}
                    className="font-manrope h-10 gap-2 rounded-lg px-5 text-sm font-bold"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {submitting ? "Sending…" : mode.cta}
                  </Button>
                  <p className="font-manrope text-xs text-muted-foreground">
                    Sent as {user?.email ?? "your account"}.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function AttachmentField({
  files,
  inputRef,
  onPick,
  onRemove,
}: {
  files: File[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (files: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div>
      <p className="font-manrope text-sm font-extrabold text-foreground">
        Screenshot <span className="font-bold text-muted-foreground">(optional)</span>
      </p>
      <p className="font-manrope mt-1 text-xs leading-5 text-muted-foreground">
        A picture of the screen when it went wrong is usually worth more than a paragraph. Up to{" "}
        {MAX_ATTACHMENTS} images or PDFs, {formatBytes(MAX_ATTACHMENT_BYTES)} each.
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
      />

      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2"
            >
              <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-manrope min-w-0 flex-1 truncate text-sm text-foreground">
                {file.name}
              </span>
              <span className="font-manrope shrink-0 text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${file.name}`}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length < MAX_ATTACHMENTS && (
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          className="font-manrope mt-3 h-10 gap-2 rounded-lg text-sm font-bold"
        >
          <Paperclip className="h-4 w-4" />
          {files.length ? "Add another" : "Attach a screenshot"}
        </Button>
      )}
    </div>
  );
}

/**
 * The "device" half of the old hint text, answered for the user.
 *
 * Shown rather than merely collected: a page that quietly attaches a browser
 * fingerprint should be able to show exactly what it is attaching.
 */
function DeviceField({
  rows,
  open,
  onToggle,
}: {
  rows: Array<{ label: string; value: string }>;
  open: boolean;
  onToggle: () => void;
}) {
  const summary = rows
    .slice(0, 3)
    .map((r) => r.value)
    .join(" · ");

  return (
    <div className="rounded-xl border border-border bg-muted/30">
      <div className="flex items-start gap-3 px-4 py-3">
        <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-manrope text-sm font-extrabold text-foreground">
            Device details, attached automatically
          </p>
          <p className="font-manrope mt-0.5 truncate text-xs text-muted-foreground">{summary}</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="font-manrope inline-flex shrink-0 items-center gap-1 pt-0.5 text-xs font-bold text-primary hover:underline"
        >
          {open ? "Hide" : "See what we send"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <dl className="grid gap-x-6 gap-y-2 border-t border-border px-4 py-3 sm:grid-cols-[9rem_1fr]">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="font-manrope text-xs font-bold text-muted-foreground">{row.label}</dt>
              <dd className="font-manrope break-words text-xs text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * The confirmation the page never had. A toast that fades after four seconds is
 * indistinguishable from nothing happening if you looked away, and the form
 * clearing itself reads as a lost draft rather than a sent one.
 */
function SentPanel({
  title,
  body,
  attachments,
  onAgain,
}: {
  title: string;
  body: string;
  attachments: number;
  onAgain: () => void;
}) {
  return (
    <div
      role="status"
      className="mt-6 overflow-hidden rounded-[24px] border border-border bg-card p-8 shadow-[0px_16px_32px_-28px_rgba(16,25,41,0.6)]"
    >
      <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
        <Check className="h-6 w-6" />
      </div>
      <h2 className="font-display mt-4 text-2xl font-bold tracking-[-0.6px] text-foreground">
        {title}
      </h2>
      <p className="font-manrope mt-2 max-w-[46ch] text-sm leading-6 text-muted-foreground">
        {body}
      </p>
      {attachments > 0 && (
        <p className="font-manrope mt-2 text-xs text-muted-foreground">
          {attachments} {attachments === 1 ? "attachment" : "attachments"} included.
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={onAgain}
          className="font-manrope h-10 rounded-lg px-5 text-sm font-bold"
        >
          Send another
        </Button>
        <Button
          asChild
          variant="outline"
          className="font-manrope h-10 rounded-lg px-5 text-sm font-bold"
        >
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
