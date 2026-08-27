import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  MailWarning,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  createPlatformUser,
  listTeamDirectory,
  type CreatePlatformUserResult,
  type CreatableTeamRole,
  type DirectoryTeam,
} from "@/lib/admin.functions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  ROLE_LABEL,
  assignableRoles,
  roleDescriptionForTier,
  type BillingTier,
} from "@everlumen/shared/team-permissions";
import { useAdminRole } from "../hooks/use-admin-role";
import { CapabilityNotice } from "./AdminTable";
import { cn } from "@/lib/utils";

/*
 * "Admin can't add a user."
 *
 * Reported as a missing button, and it was, but the reason it mattered is in
 * the sentence after it: "useful instead of creating a new subscription". The
 * only ways into the product were self-serve signup and a team invite, so
 * seating one more person on a team that already pays meant walking them
 * through a signup, a confirmation email and then an invite - and the
 * confirmation half was the thing that had been failing all along.
 *
 * So this creates the account outright, with the address already confirmed,
 * and optionally seats them on an existing team in the same step. What the
 * person receives is one message with one link, and clicking it puts them in.
 */

type AccessMode = "link" | "password";

/**
 * The little a team has to tell us to be seatable.
 *
 * Narrower than `DirectoryTeam` on purpose: the same dialog opens from the
 * users list, where a team is found by searching the directory, and from a
 * team's own page, where the team is already known and has a different shape.
 * Both can say this much.
 */
export interface SeatableTeam {
  id: string;
  name: string;
  plan: string;
  isInternal: boolean;
  memberCount: number;
  /** Only ever a subtitle in the search results. */
  ownerEmail?: string | null;
}

function tierOf(team: SeatableTeam): BillingTier {
  if (team.isInternal) return "team";
  return team.plan === "pro" || team.plan === "team" ? team.plan : "starter";
}

function fromDirectory(t: DirectoryTeam): SeatableTeam {
  return {
    id: t.id,
    name: t.name,
    plan: t.plan,
    isInternal: t.isInternal,
    memberCount: t.memberCount,
    ownerEmail: t.owner.email,
  };
}

export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
  presetTeam,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  /**
   * Opened from a team's own page, so the team is settled and the picker is
   * not shown. This is the "instead of creating a new subscription" path: the
   * operator is already looking at the customer who should absorb the seat.
   */
  presetTeam?: SeatableTeam;
}) {
  const qc = useQueryClient();
  const { denyReason } = useAdminRole();
  const denied = denyReason("owner");

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [access, setAccess] = useState<AccessMode>("link");
  const [password, setPassword] = useState("");
  const [team, setTeam] = useState<SeatableTeam | null>(presetTeam ?? null);
  const [role, setRole] = useState<CreatableTeamRole>("standard");
  const [overSeatLimit, setOverSeatLimit] = useState(false);
  const [note, setNote] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  /** The receipt, once an account exists. Replaces the form rather than sitting under it. */
  const [created, setCreated] = useState<CreatePlatformUserResult | null>(null);

  const debouncedTeamSearch = useDebouncedValue(teamSearch, 300);

  const reset = () => {
    setEmail("");
    setFullName("");
    setCompany("");
    setAccess("link");
    setPassword("");
    // Back to the preset when there is one: "Add another" from a team's page
    // means another member of that team, not a stray account.
    setTeam(presetTeam ?? null);
    setRole("standard");
    setOverSeatLimit(false);
    setNote("");
    setTeamSearch("");
    setCreated(null);
  };

  /*
   * Only searched, never listed wholesale. A dropdown of every team is a
   * scrolling exercise by the time there are fifty of them, and the operator
   * doing this already knows which customer they are seating somebody on.
   */
  const { data: teamResults, isFetching: searchingTeams } = useQuery({
    queryKey: ["admin", "team-picker", debouncedTeamSearch],
    queryFn: () =>
      listTeamDirectory({
        data: { search: debouncedTeamSearch || undefined, limit: 6, offset: 0 },
      }),
    enabled: open && !team && debouncedTeamSearch.trim().length > 1,
  });

  const tier = team ? tierOf(team) : null;
  const offeredRoles = tier ? assignableRoles(tier, { assignmentsEnforced: true }) : [];

  const pickTeam = (t: SeatableTeam) => {
    setTeam(t);
    setTeamSearch("");
    /*
     * Snap the role to something this plan can actually hold. Standard is on
     * every tier, so it is the safe landing spot when the previously selected
     * role (say Manager, which is Team-only) is not available here.
     */
    const allowed = assignableRoles(tierOf(t), { assignmentsEnforced: true });
    if (!allowed.includes(role)) setRole(allowed.includes("standard") ? "standard" : allowed[0]);
  };

  const noteRequired = !!team;
  const noteTooShort = noteRequired && note.trim().length < 3;
  const passwordTooShort = access === "password" && password.length < 8;
  const canSubmit = !!email.trim() && !noteTooShort && !passwordTooShort && !denied;

  const m = useMutation({
    mutationFn: () =>
      createPlatformUser({
        data: {
          email: email.trim(),
          fullName: fullName.trim() || undefined,
          company: company.trim() || undefined,
          password: access === "password" ? password : undefined,
          note: note.trim() || undefined,
          team: team ? { teamId: team.id, role, overSeatLimit } : undefined,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      }),
    onSuccess: (res) => {
      setCreated(res);
      // Both directories move: the user appears, and the team's member count
      // changes if they were seated on one.
      void qc.invalidateQueries({ queryKey: ["admin", "user-directory"] });
      void qc.invalidateQueries({ queryKey: ["admin", "team-directory"] });
      onCreated();
      if (res.emailSent) toast.success(`Account created. Email sent to ${res.email}.`);
      else
        toast.warning("Account created, but the email could not be sent", {
          description: res.setupLink
            ? "Copy the setup link below and send it to them yourself."
            : (res.emailReason ?? "Send them a password reset from their account page."),
        });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not create that account"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-h-[88vh] w-[520px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold">
            <UserPlus className="h-4 w-4" />
            {created ? "Account created" : "Add a user"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {created
              ? "They can sign in as soon as they open the message."
              : "Creates the account outright. The address is confirmed on creation, so there is no confirmation email to chase."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <CreatedReceipt
            result={created}
            onAddAnother={reset}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <div className="space-y-4">
            <Field label="Email" required>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="crew@company.com"
                autoComplete="off"
                className="h-9"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name">
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jordan Reyes"
                  autoComplete="off"
                  className="h-9"
                />
              </Field>
              <Field label="Company">
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Reyes HVAC"
                  autoComplete="off"
                  className="h-9"
                />
              </Field>
            </div>

            {/* ---------------- Team ---------------- */}
            <div className="rounded-xl border border-border p-3">
              <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" /> Team
              </p>

              {team ? (
                <>
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">{team.name}</p>
                      <p className="text-xs capitalize text-muted-foreground">
                        {team.isInternal ? "complimentary" : team.plan} plan · {team.memberCount}{" "}
                        {team.memberCount === 1 ? "member" : "members"}
                      </p>
                    </div>
                    {/* Fixed when the dialog was opened from this team's own
                        page: clearing it there would turn "add a member" into
                        "make a stray account", which is not what was asked. */}
                    {!presetTeam && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Remove team"
                        onClick={() => setTeam(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {offeredRoles.map((r) => (
                      <Button
                        key={r}
                        size="sm"
                        variant={role === r ? "default" : "outline"}
                        onClick={() => setRole(r as CreatableTeamRole)}
                        title={roleDescriptionForTier(r, tier!)}
                      >
                        {ROLE_LABEL[r]}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {roleDescriptionForTier(role, tier!)}
                  </p>

                  {/*
                    Offered up front rather than after a refusal, because the
                    seat count above is not the whole answer: pending invites
                    hold seats too, so a team that looks like it has room can
                    still be full. Off by default - a free seat on a paid plan
                    should be a decision, not a side effect.
                  */}
                  <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={overSeatLimit}
                      onChange={(e) => setOverSeatLimit(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-border"
                    />
                    <span>
                      <span className="font-bold text-foreground">Add past the seat limit.</span>{" "}
                      Only needed when the plan has no free seats. Recorded in the audit log.
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={teamSearch}
                      onChange={(e) => setTeamSearch(e.target.value)}
                      placeholder="Search a team by name to seat them on it"
                      className="h-9 pl-8"
                    />
                  </div>
                  {debouncedTeamSearch.trim().length > 1 && (
                    <div className="mt-2 space-y-1">
                      {searchingTeams && !teamResults ? (
                        <p className="flex items-center gap-1.5 px-1 py-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                        </p>
                      ) : teamResults?.teams.length ? (
                        teamResults.teams.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => pickTeam(fromDirectory(t))}
                            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {t.name}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {t.owner.email ?? "no owner on file"}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs capitalize text-muted-foreground">
                              {t.isInternal ? "comp" : t.plan} · {t.memberCount}
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className="px-1 py-2 text-xs text-muted-foreground">
                          No team matches that.
                        </p>
                      )}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Optional. Leave it empty to create a standalone account they can start their own
                    team from.
                  </p>
                </>
              )}
            </div>

            {/* ---------------- Access ---------------- */}
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
                How they get in
              </p>
              <div className="mt-2 space-y-1.5">
                <AccessOption
                  selected={access === "link"}
                  onSelect={() => setAccess("link")}
                  icon={<Mail className="h-3.5 w-3.5" />}
                  title="Email them a link to set a password"
                  hint="One message, one click. Nobody, including you, ever knows their password."
                />
                <AccessOption
                  selected={access === "password"}
                  onSelect={() => setAccess("password")}
                  icon={<KeyRound className="h-3.5 w-3.5" />}
                  title="Set a password now"
                  hint="For setting somebody up while they are on the phone. Tell it to them yourself: the email deliberately does not carry it."
                />
              </div>
              {access === "password" && (
                <div className="mt-2.5">
                  <Input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="off"
                    className="h-9 font-mono text-xs"
                  />
                  {/* Shown rather than masked on purpose: the whole point of
                      this branch is that the operator has to read it out. */}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Visible so you can read it out. They can change it from Settings at any time.
                  </p>
                </div>
              )}
            </div>

            {/* ---------------- Reason ---------------- */}
            <Field
              label={noteRequired ? "Reason" : "Note (optional)"}
              required={noteRequired}
              hint={
                noteRequired
                  ? "Seating someone on a customer's team gives them the run of its projects, so this one is recorded."
                  : "Recorded in the audit log next to the account."
              }
            >
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={
                  noteRequired ? "Replacing the foreman who left, per Tuesday's call" : ""
                }
                className="resize-none text-sm"
              />
            </Field>

            <CapabilityNotice reason={denied} />

            <div className="flex justify-end gap-2 pt-1">
              <DialogClose asChild>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button size="sm" disabled={!canSubmit || m.isPending} onClick={() => m.mutate()}>
                {m.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Creating…
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Create account
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * What actually happened, before the dialog closes.
 *
 * The important half is the failure case: if the mail did not go out, the
 * account still exists and the person has no way in, so the link they should
 * have received has to be reachable from here. A toast that has already faded
 * is not a place to keep somebody's only credential.
 */
function CreatedReceipt({
  result,
  onAddAnother,
  onDone,
}: {
  result: CreatePlatformUserResult;
  onAddAnother: () => void;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/40 p-3">
        <p className="text-sm font-bold text-foreground">{result.email}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {result.team
            ? `Added to ${result.team.name} as ${ROLE_LABEL[result.team.role]}.`
            : "No team. They can create one, or be invited to one later."}
          {result.team?.overSeatLimit ? " Seated past the plan's limit." : ""}
        </p>
      </div>

      <div
        className={cn(
          "flex items-start gap-2 rounded-xl border p-3",
          result.emailSent
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-amber-500/30 bg-amber-500/5",
        )}
      >
        {result.emailSent ? (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">
            {result.emailSent ? "Email sent" : "The email could not be sent"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {result.emailSent
              ? result.setupLink
                ? "It carries a one-time link to choose a password."
                : "It points them at the sign-in page."
              : (result.emailReason ??
                "Send them the link below, or a password reset from their account page.")}
          </p>
        </div>
      </div>

      {result.setupLink && (
        <div>
          <p className="text-xs font-bold text-foreground">Set-password link</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Single use, expires in an hour. Anyone holding it can enter this account, so send it to
            them and nowhere else.
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
              {result.setupLink}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(result.setupLink!);
                setCopied(true);
                toast.success("Link copied");
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={onAddAnother}>
          Add another
        </Button>
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </label>
  );
}

function AccessOption({
  selected,
  onSelect,
  icon,
  title,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
      )}
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
