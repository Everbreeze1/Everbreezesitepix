import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { getPlatformTeamDetail, type PlatformBusinessProfile } from "@/lib/admin.functions";
import { formatBytes } from "@/hooks/use-storage-usage";
import { TeamBillingPanel } from "../components/TeamBillingPanel";
import {
  COMPANY_GOALS,
  HEARD_FROM,
  PROJECT_VOLUMES,
  TEAM_SIZES,
  choiceLabel,
  industryLabel,
} from "@everlumen/shared";

export function AdminTeamDetailPage() {
  const { teamId } = useParams({ from: "/_app/admin/teams_/$teamId" });

  const { data, isPending } = useQuery({
    queryKey: ["admin", "teams", "detail", teamId],
    queryFn: () => getPlatformTeamDetail({ data: { teamId } }),
  });

  if (isPending || !data) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/admin/teams"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to teams
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-foreground">{data.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.plan} plan · {data.subscriptionStatus} ·{" "}
            {new Date(data.createdAt).toLocaleDateString()}
          </p>
        </div>
        {data.stripeCustomerId && (
          <a
            href={`https://dashboard.stripe.com/customers/${data.stripeCustomerId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open in Stripe
          </a>
        )}
      </div>

      {/*
        This note used to say the whole page was read-only. That stopped being
        true when the billing panel landed, and a safety notice that is wrong
        about what the screen can do is worse than none - so it now says what is
        actually still true: you are not acting AS this team, and everything you
        can do from here is logged.
      */}
      <p className="mt-4 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
        Inspection view for support. You are not signed in as this team and cannot act on its
        behalf. The billing controls below change this team&apos;s access and are recorded in the
        audit log.
      </p>

      <TeamBillingPanel teamId={teamId} />

      <BusinessProfilePanel profile={data.businessProfile} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-extrabold text-foreground">
            Members <span className="text-muted-foreground">({data.members.length})</span>
          </p>
          <div className="mt-3 space-y-2">
            {data.members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between border-t border-border pt-2 text-sm first:border-t-0 first:pt-0"
              >
                <div>
                  <p className="font-medium text-foreground">{m.fullName ?? "-"}</p>
                  <p className="text-xs text-muted-foreground">{m.email ?? "-"}</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold capitalize text-muted-foreground">
                  {m.role}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-extrabold text-foreground">
            Projects <span className="text-muted-foreground">({data.projects.length})</span>
          </p>
          <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
            {data.projects.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No projects yet.</p>
            ) : (
              data.projects.map((p) => (
                <div
                  key={p.id}
                  className="border-t border-border pt-2 text-sm first:border-t-0 first:pt-0"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-foreground">{p.name}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold capitalize text-muted-foreground">
                      {p.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.photoCount} photos · {formatBytes(p.storageBytes)} · updated{" "}
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * What this company told the setup wizard.
 *
 * Sits above members and projects because it is the only thing on this page
 * that says WHY the account exists. Everything below it is volume.
 *
 * "Here to fix" is the reason the panel was built: those are the concerns the
 * company selected for themselves, and they were being written to a column
 * nothing read. A support conversation that starts from "you told us the
 * problem was proving what you did when someone disputes it" is a different
 * conversation from one that starts from a photo count.
 */
function BusinessProfilePanel({ profile }: { profile: PlatformBusinessProfile }) {
  const industry = industryLabel(profile.industry);

  if (!industry) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-5">
        <p className="text-sm font-extrabold text-foreground">Business profile</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Not answered. This team has never completed the account setup wizard, so their template
          library is still in its default order.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-extrabold text-foreground">Business profile</p>
        {profile.completedAt && (
          <p className="text-xs text-muted-foreground">
            Completed {new Date(profile.completedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Industry" value={industry} />
        <Field
          label="Also does"
          value={
            profile.trades.length
              ? profile.trades.map((t) => industryLabel(t) ?? t).join(", ")
              : null
          }
        />
        <Field label="Team size" value={choiceLabel(TEAM_SIZES, profile.teamSize)} />
        <Field label="Jobs a month" value={choiceLabel(PROJECT_VOLUMES, profile.projectVolume)} />
        <Field label="Service area" value={profile.serviceArea} />
        <Field label="Found us via" value={choiceLabel(HEARD_FROM, profile.heardFrom)} />
      </dl>

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Here to fix
        </p>
        {profile.goals.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Skipped this step.</p>
        ) : (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {profile.goals.map((g) => (
              <span
                key={g}
                className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary"
              >
                {COMPANY_GOALS.find((c) => c.id === g)?.label ?? g}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-foreground">
        {value ?? <span className="font-normal text-muted-foreground">Not answered</span>}
      </dd>
    </div>
  );
}
