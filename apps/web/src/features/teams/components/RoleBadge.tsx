import { Crown, Lock, Shield, User as UserIcon, UserCog } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  normaliseRole,
  roleDescriptionForTier,
  roleLabelForTier,
  type BillingTier,
  type TeamRole,
} from "@sitepix/shared/team-permissions";

/**
 * What role somebody holds, on their row, without opening anything.
 *
 * The roster used to print only the role's DESCRIPTION under a name, in the
 * same grey as "Active 2h ago" and worded as a sentence rather than as a label.
 * The effect was a page where every member looked the same at a glance and the
 * only way to learn who was an Admin was to read four lines of prose. Reported
 * as "there's no way to see what role a member currently has", which was fair:
 * a permission you cannot see is a permission you cannot audit.
 *
 * The label is tier-aware, because the tiers genuinely name the base seat
 * differently: Team runs a hierarchy and calls it Standard, Pro is flat and
 * calls it Member. `roleLabelForTier` owns that rule so no screen re-derives it.
 *
 * Colour carries meaning and is never the only thing that does: each badge has
 * its own icon and its own word, so it reads the same to somebody who cannot
 * separate the amber from the violet.
 */

const STYLE: Record<TeamRole, { className: string; Icon: typeof Shield }> = {
  owner: {
    className: "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-400",
    Icon: Crown,
  },
  admin: {
    className: "border-violet-500/30 bg-violet-500/12 text-violet-700 dark:text-violet-400",
    Icon: Shield,
  },
  manager: {
    className: "border-sky-500/30 bg-sky-500/12 text-sky-700 dark:text-sky-400",
    Icon: UserCog,
  },
  standard: {
    className: "border-border bg-muted text-muted-foreground",
    Icon: UserIcon,
  },
  restricted: {
    className: "border-orange-500/30 bg-orange-500/12 text-orange-700 dark:text-orange-400",
    Icon: Lock,
  },
};

export function RoleBadge({
  role,
  tier,
  size = "sm",
  className,
}: {
  role: string | null | undefined;
  tier: BillingTier;
  /** `xs` for inline use inside a list row, `sm` for the roster. */
  size?: "xs" | "sm";
  className?: string;
}) {
  const r = normaliseRole(role);
  const { className: tone, Icon } = STYLE[r];
  const label = roleLabelForTier(r, tier);
  const description = roleDescriptionForTier(r, tier);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/*
            A span, not a button: it is a label, and making it focusable would
            put a stop on the keyboard path through the roster for something
            that has no action behind it. The tooltip is a nicety on top of a
            badge that already says the role in words.
          */}
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border font-manrope font-extrabold uppercase tracking-[0.5px]",
              size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]",
              tone,
              className,
            )}
            title={description}
          >
            <Icon className={size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"} />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px] text-xs">
          <div className="font-semibold">{label}</div>
          <div className="text-muted-foreground">{description}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
