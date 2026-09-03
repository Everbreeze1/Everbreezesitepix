import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";
import { getMyTeam } from "@/lib/teams.functions";

export interface SubscriptionRow {
  id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export type BillingTier = "starter" | "pro" | "team";

export const PLAN_LIMITS = {
  starter: { storageBytes: 50 * 1024 ** 3 }, // 50 GB
  pro: { storageBytes: 100 * 1024 ** 3 }, // 100 GB
  team: { storageBytes: 200 * 1024 ** 3 }, // 200 GB
} as const;

/**
 * Auto Reports included with Pro, per user per calendar month. Team is
 * unlimited; Starter has no access. Keep in sync with
 * PRO_AUTO_REPORTS_PER_MONTH in apps/api/src/domains/walkthroughs/auto-report-quota.ts,
 * which is what actually enforces the cap.
 */
export const PRO_AUTO_REPORTS_PER_MONTH = 100;

interface MyTeamResult {
  team: { id: string } | null;
  plan?: BillingTier;
  isActive?: boolean;
  isInternal?: boolean;
  subscriptionStatus?: string;
}

export function useSubscription() {
  const { user, loading: authLoading } = useAuth();
  const [aiAnalysesUsed, setAiAnalysesUsed] = useState(0);
  const [autoReportsUsed, setAutoReportsUsed] = useState(0);

  const {
    data: teamData,
    isPending: teamPending,
    isError: teamErrored,
    refetch: refetchTeam,
  } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await getMyTeam()) as MyTeamResult,
    enabled: !authLoading && !!user,
  });

  const fetchUsage = useCallback(async () => {
    if (!user) return;
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const [{ count: aiCount }, { count: autoReportCount }] = await Promise.all([
      supabase
        .from("ai_analyses")
        .select("id", { count: "exact", head: true })
        .eq("created_by", user.id)
        .gte("created_at", start.toISOString()),
      supabase
        .from("auto_report_generations" as any)
        .select("id", { count: "exact", head: true })
        .eq("created_by", user.id)
        .gte("created_at", start.toISOString()),
    ]);
    setAiAnalysesUsed(aiCount ?? 0);
    setAutoReportsUsed(autoReportCount ?? 0);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void fetchUsage();
  }, [authLoading, fetchUsage]);

  useEffect(() => {
    if (!user) return;
    const channelName = `subscriptions:${user.id}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ai_analyses",
          filter: `created_by=eq.${user.id}`,
        },
        () => void fetchUsage(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "auto_report_generations",
          filter: `created_by=eq.${user.id}`,
        },
        () => void fetchUsage(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, fetchUsage]);

  // isPending (not isLoading) is what actually stays true for the entire
  // window from "query disabled" through "fetch in flight" - isLoading is
  // derived as isPending && isFetching in React Query v5, so it can read
  // false with data still undefined during the single render-frame gap
  // right as the query transitions from disabled to enabled. Trusting that
  // gap here was causing _app.tsx's paywall gate to redirect active
  // subscribers to /pricing on a false negative right after login.
  const loading = authLoading || (!!user && teamPending);
  const hasError = !authLoading && !!user && teamErrored;
  const isActive = !!teamData?.isActive;
  const isInternal = !!teamData?.isInternal;
  // Internal/complimentary teams get full Team-tier access regardless of the
  // raw plan column - mirrors the old owner/test-account allowlists this flag
  // replaced, which granted unconditional full access, not just a paywall bypass.
  const tier: BillingTier = isInternal ? "team" : (teamData?.plan ?? "starter");
  const isTeam = isActive && tier === "team";
  const isPro = isActive && (tier === "pro" || tier === "team");
  const isStarter = isActive && tier === "starter";
  const limits = PLAN_LIMITS[tier];

  // Auto Reports (AI reports generated from a walkthrough's spoken transcript
  // + captured photos) are Pro/Team only. Mirrors the server-side allowance in
  // apps/api/src/domains/walkthroughs/auto-report-quota.ts - that module is the
  // enforcing authority; this is only what the UI displays.
  const autoReportsLimit = isTeam ? Infinity : isPro ? PRO_AUTO_REPORTS_PER_MONTH : 0;
  const autoReportsRemaining =
    autoReportsLimit === Infinity ? Infinity : Math.max(0, autoReportsLimit - autoReportsUsed);

  return {
    subscription: null as SubscriptionRow | null,
    loading,
    hasError,
    retry: () => void refetchTeam(),
    isActive,
    isInternal,
    isTrialing: false,
    trialDaysRemaining: 0,
    trialEndsAt: null as Date | null,
    planName: isActive ? `${tier[0].toUpperCase()}${tier.slice(1)}` : "Inactive",
    tier,
    isStarter,
    isPro,
    isTeam,
    canUseAiChat: isActive,
    canAttachPhotoInChat: isPro,
    canUseTeamFeatures: isPro,
    canUseWatermark: isPro,
    canUseWalkthroughs: isPro,
    // The manual photo-report builder is a Starter-tier tool. Pro/Team generate
    // documents with AI instead, so surfacing the manual builder to them is
    // clutter. Expressed as `!isPro` rather than `isStarter` so the button only
    // ever *disappears* for Pro/Team - an inactive or still-loading
    // subscription keeps it rather than silently losing the feature.
    canUseManualPhotoReport: !isPro,
    limits,
    aiAnalysesUsed,
    aiAnalysesRemaining: Infinity,
    aiAnalysesLimit: Infinity,
    aiUnlimited: true,
    bumpAiAnalysesUsed: () => setAiAnalysesUsed((n) => n + 1),
    /** Auto Reports: AI reports generated from walkthrough transcript + photos. */
    canUseAutoReports: isPro,
    autoReportsUsed,
    autoReportsLimit,
    autoReportsRemaining,
    bumpAutoReportsUsed: () => setAutoReportsUsed((n) => n + 1),
    refresh: () => fetchUsage(),
  };
}


