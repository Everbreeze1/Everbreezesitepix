/**
 * The Company settings rules, free of React and the network so they can be
 * tested. Mirrors the web Settings page's Company section and the parts of
 * `useSubscription` it reads.
 */

export type CompanyTeamFacts = {
  plan?: string | null;
  isActive?: boolean;
  isInternal?: boolean;
  myRole?: string | null;
};

/** The web's `PLAN_LIMITS` (apps/web/src/hooks/use-subscription.ts). */
export const PLAN_STORAGE_BYTES = {
  starter: 50 * 1024 ** 3,
  pro: 100 * 1024 ** 3,
  team: 200 * 1024 ** 3,
} as const;

type Tier = keyof typeof PLAN_STORAGE_BYTES;

/** The tier the web bills this workspace as: internal teams count as Team. */
export function tierFor(team: CompanyTeamFacts | null | undefined): Tier {
  if (team?.isInternal) return "team";
  const plan = team?.plan;
  return plan === "pro" || plan === "team" ? plan : "starter";
}

/**
 * The web's `canUseWatermark`, which is `isPro`: an active Pro or Team plan,
 * or an internal workspace.
 */
export function canUseWatermark(team: CompanyTeamFacts | null | undefined): boolean {
  if (!team) return false;
  if (team.isInternal) return true;
  const tier = tierFor(team);
  return Boolean(team.isActive) && (tier === "pro" || tier === "team");
}

/**
 * Whether plan details may be shown. Only the account owner sees what the
 * workspace pays for; an invited member is never told the plan, the tier or
 * the storage allowance that follows from it.
 */
export function showsPlanDetails(team: CompanyTeamFacts | null | undefined): boolean {
  return team?.myRole === "owner";
}

/** The switch's state, as the web draws it: on unless it was turned off, and only when allowed. */
export function watermarkOn(allowed: boolean, enabled: boolean | null | undefined): boolean {
  return allowed && enabled !== false;
}

/** The line under the watermark switch. Never names a plan to somebody who is not the owner. */
export function watermarkNote(args: {
  allowed: boolean;
  hasLogo: boolean;
  owner: boolean;
}): string {
  if (!args.allowed) {
    return args.owner
      ? "Needs a Pro or Team plan."
      : "Not switched on for this workspace. Ask the account owner.";
  }
  if (!args.hasLogo) return "Upload a logo first. It is the mark that goes on the photos.";
  return "A subtle mark on every exported field photo.";
}

/** The web's `formatBytes`, so both surfaces print the same figure. */
export function formatStorage(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export type StorageSummary = {
  line: string;
  /** 0 to 100, or null when there is no allowance to measure against on screen. */
  percent: number | null;
};

/**
 * The storage line. The owner sees usage against the plan's allowance, as on
 * the web; anyone else sees only what their own photos use.
 */
export function storageSummary(
  bytesUsed: number,
  team: CompanyTeamFacts | null | undefined,
): StorageSummary {
  const used = Number.isFinite(bytesUsed) && bytesUsed > 0 ? bytesUsed : 0;
  if (!showsPlanDetails(team)) {
    return { line: `${formatStorage(used)} used by the photos you uploaded`, percent: null };
  }
  const tier = tierFor(team);
  const limit = PLAN_STORAGE_BYTES[tier];
  const plan = `${tier[0].toUpperCase()}${tier.slice(1)} plan`;
  return {
    line: `${plan} \u00b7 ${formatStorage(used)} of ${formatStorage(limit)} used`,
    percent: Math.max(2, Math.min(100, (used / limit) * 100)),
  };
}

/** Reads the `size_bytes.sum()` aggregate the web asks for, whatever shape it arrives in. */
export function readStorageSum(row: unknown): number {
  const sum = (row as { sum?: number | string } | null)?.sum;
  const total = Number(sum ?? 0);
  return Number.isFinite(total) ? total : 0;
}

/** File extension and type for an uploaded logo. PNG keeps a transparent background. */
export function logoPath(userId: string, now: number = Date.now()): string {
  return `${userId}/logo-${now}.png`;
}

export type CompanyFields = {
  company: string;
  phone: string;
  address: string;
  website: string;
};

/** Blank is stored as null, as the web does. */
export function companyPatch(fields: CompanyFields): {
  company: string | null;
  company_phone: string | null;
  company_address: string | null;
} {
  return {
    company: fields.company.trim() || null,
    company_phone: fields.phone.trim() || null,
    company_address: fields.address.trim() || null,
  };
}
