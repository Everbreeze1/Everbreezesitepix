import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import {
  COMPANY_GOALS,
  HEARD_FROM,
  INDUSTRIES,
  PROJECT_VOLUMES,
  TEAM_SIZES,
  findIndustry,
  recommendedCategories,
  type BusinessProfile,
  type Choice,
} from "@everlumen/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { categoryIcon } from "@/lib/template-categories";
import { saveCompanyProfile } from "@/lib/teams.functions";

/*
 * The account setup wizard.
 *
 * Signing up asks three questions, and that is correct - nobody should have to
 * describe their business before they have seen the product. But it means the
 * moment they are in, we know nothing, and the whole template library is sorted
 * by an opinion we formed without them: a cleaning contractor's templates sat
 * seventh, under three trades they will never open.
 *
 * So this is where the rest of the questions live, and the rules it follows
 * are all consequences of it being optional:
 *
 *   * four steps, one question each, because a single long form reads as work;
 *   * the first step is the only one that gates Next, and only on the industry,
 *     which is the answer the templates actually turn on;
 *   * every later step can be skipped and the wizard still saves what it has;
 *   * the last step shows what the answers changed, so the time spent visibly
 *     bought something rather than disappearing into our analytics.
 *
 * It is also the account's first write for most people: a trial has no team
 * row until something creates one, so `saveCompanyProfile` creates it from the
 * company name on step one. That is why step one asks for the name at all.
 */

type StepId = "industry" | "size" | "goals" | "done";

const STEPS: { id: StepId; title: string; blurb: string }[] = [
  {
    id: "industry",
    title: "What does your company do?",
    blurb: "This decides which templates you see first. You can change it any time.",
  },
  {
    id: "size",
    title: "How big is the team?",
    blurb:
      "So the defaults suit a two-person crew or a fifty-tech operation, not the average of both.",
  },
  {
    id: "goals",
    title: "What do you need this to fix?",
    blurb: "Pick as many as apply. It tells us what to build next for companies like yours.",
  },
  { id: "done", title: "You are set up", blurb: "" },
];

interface Draft {
  companyName: string;
  industry: string | null;
  trades: string[];
  team_size: string | null;
  project_volume: string | null;
  goals: string[];
  heard_from: string | null;
  service_area: string;
}

export function AccountSetupDialog({
  open,
  onOpenChange,
  profile,
  companyName,
  hasTeam,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is already stored, so re-running this edits rather than restarts. */
  profile: BusinessProfile;
  companyName: string | null;
  /** False for a trial account with no team row yet - the name becomes required. */
  hasTeam: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => seed(profile, companyName));

  /*
   * Re-seed on open, not on mount. The dialog stays mounted between openings,
   * so without this a second visit shows whatever was typed the first time -
   * including answers that were saved and then edited elsewhere in Settings.
   */
  useEffect(() => {
    if (!open) return;
    setDraft(seed(profile, companyName));
    setStep(0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = STEPS[step];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const toggle = (key: "trades" | "goals", id: string) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id],
    }));

  const canAdvance =
    current.id !== "industry" || (!!draft.industry && (hasTeam || !!draft.companyName.trim()));

  async function save(andClose: boolean) {
    setSaving(true);
    try {
      await saveCompanyProfile({
        data: {
          // Only sent when it says something. An empty string here would be a
          // request to rename the company to nothing.
          ...(draft.companyName.trim() ? { companyName: draft.companyName.trim() } : {}),
          industry: draft.industry,
          trades: draft.trades,
          team_size: draft.team_size,
          project_volume: draft.project_volume,
          goals: draft.goals,
          heard_from: draft.heard_from,
          service_area: draft.service_area.trim() || null,
        },
      });
      await onSaved();
      if (andClose) onOpenChange(false);
      else setStep(STEPS.length - 1);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save your details");
    } finally {
      setSaving(false);
    }
  }

  const recommended = useMemo(
    () => recommendedCategories(draft.industry, draft.trades),
    [draft.industry, draft.trades],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 pb-4 pt-5 text-left">
          <p className="font-manrope text-[10px] font-extrabold uppercase tracking-[1.6px] text-primary">
            Set up your account {step + 1} of {STEPS.length}
          </p>
          <DialogTitle className="mt-1.5 text-xl">{current.title}</DialogTitle>
          {current.blurb ? (
            <DialogDescription className="text-sm">{current.blurb}</DialogDescription>
          ) : (
            /* Radix warns when a dialog has no description, and an empty one is
               still a description - the last step's heading says it all. */
            <DialogDescription className="sr-only">
              Your account is set up and your templates are sorted for your trade.
            </DialogDescription>
          )}
          <div className="mt-4 flex gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  "h-1 flex-1 rounded-full transition",
                  i <= step ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {current.id === "industry" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="setup-company" className="text-sm font-bold">
                  Company name
                </Label>
                <Input
                  id="setup-company"
                  value={draft.companyName}
                  onChange={(e) => set("companyName", e.target.value)}
                  placeholder="Northwind Mechanical"
                  className="h-11"
                />
                {!hasTeam && (
                  <p className="text-xs text-muted-foreground">
                    This names your workspace, and it is what prints on the documents you send
                    clients.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-bold">Your trade</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {INDUSTRIES.map((ind) => {
                    const Icon = categoryIcon(ind.categories[0]);
                    const selected = draft.industry === ind.id;
                    return (
                      <button
                        key={ind.id}
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            industry: ind.id,
                            // A trade cannot be both the main answer and an
                            // "also do" - it would show up twice on step two.
                            trades: d.trades.filter((t) => t !== ind.id),
                          }))
                        }
                        className={cn(
                          "flex items-start gap-2.5 rounded-xl border p-3 text-left transition",
                          selected
                            ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                            : "border-border hover:border-primary/40 hover:bg-accent/40",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                            selected ? "bg-primary text-primary-foreground" : "bg-muted",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-foreground">
                            {ind.label}
                          </span>
                          <span className="block text-xs leading-snug text-muted-foreground">
                            {ind.hint}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {draft.industry && (
                <div className="space-y-2">
                  <p className="text-sm font-bold">Anything else you also do?</p>
                  <p className="text-xs text-muted-foreground">
                    Optional. Plenty of companies are two things, and we will put both trades near
                    the top of your templates.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {INDUSTRIES.filter((i) => i.id !== draft.industry && i.id !== "other").map(
                      (ind) => (
                        <Chip
                          key={ind.id}
                          label={ind.label}
                          selected={draft.trades.includes(ind.id)}
                          onClick={() => toggle("trades", ind.id)}
                        />
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {current.id === "size" && (
            <div className="space-y-6">
              <ChoiceGroup
                title="Team size"
                options={TEAM_SIZES}
                value={draft.team_size}
                onChange={(v) => set("team_size", v)}
              />
              <ChoiceGroup
                title="Jobs you document in a typical month"
                options={PROJECT_VOLUMES}
                value={draft.project_volume}
                onChange={(v) => set("project_volume", v)}
              />
              <div className="space-y-2">
                <Label htmlFor="setup-area" className="text-sm font-bold">
                  Where you work
                </Label>
                <Input
                  id="setup-area"
                  value={draft.service_area}
                  onChange={(e) => set("service_area", e.target.value)}
                  placeholder="Greater Manchester, or within 50 miles of Denver"
                  className="h-11"
                  maxLength={120}
                />
              </div>
            </div>
          )}

          {current.id === "goals" && (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  {COMPANY_GOALS.map((g) => {
                    const selected = draft.goals.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => toggle("goals", g.id)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl border p-3 text-left text-sm transition",
                          selected
                            ? "border-primary bg-primary/5 font-bold text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/40 hover:bg-accent/40",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="leading-snug">{g.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <ChoiceGroup
                title="How did you find us?"
                options={HEARD_FROM}
                value={draft.heard_from}
                onChange={(v) => set("heard_from", v)}
              />
            </div>
          )}

          {current.id === "done" && (
            <div className="space-y-5 py-4 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10">
                <PartyPopper className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">
                  {draft.companyName.trim() || "Your company"} is set up
                </p>
                <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
                  {findIndustry(draft.industry)?.label ?? "Your"} templates now lead the library,
                  everywhere you pick one.
                </p>
              </div>
              {recommended.length > 0 && (
                <div className="mx-auto flex max-w-md flex-wrap justify-center gap-1.5">
                  {recommended.map((c) => {
                    const Icon = categoryIcon(c);
                    return (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {c}
                      </span>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Change any of this later in Settings, under Company.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
          {step > 0 && current.id !== "done" ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={saving}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            {current.id === "done" ? (
              <Button onClick={() => onOpenChange(false)}>Start using it</Button>
            ) : (
              <>
                {/*
                  A skip that saves. Someone who answered step one and does not
                  want to answer step three has still told us the thing that
                  matters most, and losing it because they closed the wizard
                  would mean asking them again tomorrow.
                */}
                {step > 0 && (
                  <Button variant="ghost" onClick={() => save(true)} disabled={saving}>
                    Finish later
                  </Button>
                )}
                {step === STEPS.length - 2 ? (
                  <Button onClick={() => save(false)} disabled={!canAdvance || saving}>
                    {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                    Save and finish
                  </Button>
                ) : (
                  <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
                    Continue <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function seed(profile: BusinessProfile, companyName: string | null): Draft {
  return {
    companyName: companyName ?? "",
    industry: profile.industry,
    trades: profile.trades ?? [],
    team_size: profile.team_size,
    project_volume: profile.project_volume,
    goals: profile.goals ?? [],
    heard_from: profile.heard_from,
    service_area: profile.service_area ?? "",
  };
}

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-bold transition",
        selected
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

/** Single-select row of chips. Clicking the chosen one clears it. */
function ChoiceGroup({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: readonly Choice[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-bold">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Chip
            key={o.id}
            label={o.hint ? `${o.label} (${o.hint})` : o.label}
            selected={value === o.id}
            onClick={() => onChange(value === o.id ? null : o.id)}
          />
        ))}
      </div>
    </div>
  );
}
