import { isBusinessProfileComplete, type BusinessProfile } from "@everlumen/shared";
import type { CompanyProfilePatch } from "./workspace";

/**
 * The first-time account setup rules, free of React and the network.
 *
 * Mirrors the web's `useCompanySetup` hook and `AccountSetupDialog`: the answers
 * live on the team row, "not now" lives on the person's profile, and the
 * wizard is four steps of which only the first gates Next.
 */

export const EMPTY_PROFILE: BusinessProfile = {
  industry: null,
  trades: [],
  team_size: null,
  project_volume: null,
  goals: [],
  heard_from: null,
  service_area: null,
  profile_completed_at: null,
};

/**
 * The profile off the `getMyTeam` team row, read defensively: a database
 * without the profile columns yet answers "not answered", not a crash on Home.
 */
export function profileFromTeam(team: Record<string, unknown> | null | undefined): BusinessProfile {
  if (!team) return EMPTY_PROFILE;
  const str = (key: string) => (typeof team[key] === "string" ? (team[key] as string) : null);
  const list = (key: string) =>
    Array.isArray(team[key]) ? (team[key] as unknown[]).filter((v) => typeof v === "string") : [];
  return {
    industry: str("industry"),
    trades: list("trades") as string[],
    team_size: str("team_size"),
    project_volume: str("project_volume"),
    goals: list("goals") as string[],
    heard_from: str("heard_from"),
    service_area: str("service_area"),
    profile_completed_at: str("profile_completed_at"),
  };
}

/**
 * Owners and admins answer for the company. No team yet means nobody has
 * claimed it, so the person looking is the one who will own it.
 */
export function canEditCompanyProfile(
  hasTeam: boolean,
  myRole: string | null | undefined,
): boolean {
  return !hasTeam || myRole === "owner" || myRole === "admin";
}

/** Show the card: loaded, incomplete, allowed, and not dismissed. Never while loading. */
export function shouldPromptSetup(facts: {
  loading: boolean;
  profile: BusinessProfile;
  canEdit: boolean;
  dismissed: boolean;
}): boolean {
  return (
    !facts.loading && !isBusinessProfileComplete(facts.profile) && facts.canEdit && !facts.dismissed
  );
}

/** Per device and per person, as the web's per-browser key: the wizard opens itself once. */
export function setupAutoOpenKey(userId: string): string {
  return `everlumen:setup-wizard-shown:${userId}`;
}

export type SetupStepId = "industry" | "size" | "goals" | "done";

export const SETUP_STEPS: readonly { id: SetupStepId; title: string; blurb: string }[] = [
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

export type SetupDraft = {
  companyName: string;
  industry: string | null;
  trades: string[];
  team_size: string | null;
  project_volume: string | null;
  goals: string[];
  heard_from: string | null;
  service_area: string;
};

/** What is already stored, so re-running the wizard edits rather than restarts. */
export function seedDraft(profile: BusinessProfile, companyName: string | null): SetupDraft {
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

/** Picking the main trade drops it from "also do", so it is never listed twice. */
export function withIndustry(draft: SetupDraft, industry: string): SetupDraft {
  return { ...draft, industry, trades: draft.trades.filter((t) => t !== industry) };
}

export function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * Only the first step gates Next, and only on the industry, plus a name when
 * there is no team yet: that save is what creates the workspace.
 */
export function canAdvance(step: SetupStepId, draft: SetupDraft, hasTeam: boolean): boolean {
  if (step !== "industry") return true;
  return Boolean(draft.industry) && (hasTeam || Boolean(draft.companyName.trim()));
}

/** The save, as the web sends it. An empty name is left out rather than sent as a rename to nothing. */
export function setupPayload(draft: SetupDraft): CompanyProfilePatch {
  const name = draft.companyName.trim();
  return {
    ...(name ? { companyName: name } : {}),
    industry: draft.industry,
    trades: draft.trades,
    team_size: draft.team_size,
    project_volume: draft.project_volume,
    goals: draft.goals,
    heard_from: draft.heard_from,
    service_area: draft.service_area.trim() || null,
  };
}
