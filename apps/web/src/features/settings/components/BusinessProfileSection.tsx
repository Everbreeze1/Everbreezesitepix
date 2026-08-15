import { useState } from "react";
import { Building2, Pencil, Sparkles } from "lucide-react";
import {
  COMPANY_GOALS,
  HEARD_FROM,
  PROJECT_VOLUMES,
  TEAM_SIZES,
  choiceLabel,
  findIndustry,
  industryLabel,
  recommendedCategories,
} from "@sitepix/shared";
import { Button } from "@/components/ui/button";
import { categoryIcon } from "@/lib/template-categories";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { AccountSetupDialog } from "./AccountSetupDialog";

/**
 * The business profile, as it reads once it has been answered.
 *
 * Settings is where someone goes to change a thing they already told us, so
 * this shows the answers and opens the same wizard to edit them, rather than
 * being a second form that could drift out of step with the first. One place
 * asks the questions; this place displays them.
 *
 * Unanswered, it is the prompt instead - the dashboard card is dismissible and
 * plenty of people will dismiss it, and Settings should still offer the way in.
 */
export function BusinessProfileSection() {
  const setup = useCompanySetup();
  const [open, setOpen] = useState(false);

  const { profile, canEdit } = setup;
  const industry = findIndustry(profile.industry);
  const recommended = recommendedCategories(profile.industry, profile.trades);

  return (
    <>
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <div className="font-manrope text-base font-extrabold text-foreground">
                Business profile
              </div>
              <p className="mt-1 max-w-xl font-manrope text-sm text-muted-foreground">
                Your industry decides which document templates lead the library, everywhere you pick
                one. The rest tells us what to build next for companies your size.
              </p>
            </div>
          </div>
          {canEdit && (
            <Button
              variant={industry ? "outline" : "default"}
              onClick={() => setOpen(true)}
              className="shrink-0 font-bold"
            >
              {industry ? (
                <>
                  <Pencil className="mr-1.5 h-4 w-4" /> Edit
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" /> Set up
                </>
              )}
            </Button>
          )}
        </div>

        {industry ? (
          <>
            <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Row label="Industry" value={industry.label} />
              <Row
                label="Also does"
                value={
                  profile.trades.length
                    ? profile.trades.map((t) => industryLabel(t) ?? t).join(", ")
                    : null
                }
              />
              <Row label="Team size" value={choiceLabel(TEAM_SIZES, profile.team_size)} />
              <Row
                label="Jobs a month"
                value={choiceLabel(PROJECT_VOLUMES, profile.project_volume)}
              />
              <Row label="Service area" value={profile.service_area} />
              <Row label="Found us via" value={choiceLabel(HEARD_FROM, profile.heard_from)} />
              <div className="sm:col-span-2">
                <Row
                  label="Here to fix"
                  value={
                    profile.goals.length
                      ? profile.goals
                          .map((g) => COMPANY_GOALS.find((c) => c.id === g)?.label ?? g)
                          .join(" · ")
                      : null
                  }
                />
              </div>
            </dl>

            {recommended.length > 0 && (
              <div className="mt-5 border-t border-border pt-4">
                <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
                  Templates you see first
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
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
              </div>
            )}
          </>
        ) : (
          <p className="mt-4 font-manrope text-sm text-muted-foreground">
            {canEdit
              ? "Not set up yet, so the template library is in its default order."
              : "Your account owner or an admin sets this for the whole company."}
          </p>
        )}
      </div>

      <AccountSetupDialog
        open={open}
        onOpenChange={setOpen}
        profile={profile}
        companyName={setup.companyName}
        hasTeam={!!setup.teamId}
        onSaved={setup.refresh}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-manrope text-sm font-semibold text-foreground">
        {value ?? <span className="font-normal text-muted-foreground">Not answered</span>}
      </dd>
    </div>
  );
}
