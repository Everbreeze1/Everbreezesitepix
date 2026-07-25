import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/sitepix/client";
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

  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await getMyTeam()) as MyTeamResult,
    enabled: !authLoading && !!user,
  });

  const fetchUsage = useCallback(async () => {
    if (!user) return;
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("ai_analyses")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id)
      .gte("created_at", start.toISOString());
    setAiAnalysesUsed(count ?? 0);
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
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, fetchUsage]);

  const loading = authLoading || teamLoading;
  const isActive = !!teamData?.isActive;
  const isInternal = !!teamData?.isInternal;
  // Internal/complimentary teams get full Team-tier access regardless of the
  // raw plan column — mirrors the old owner/test-account allowlists this flag
  // replaced, which granted unconditional full access, not just a paywall bypass.
  const tier: BillingTier = isInternal ? "team" : (teamData?.plan ?? "starter");
  const isTeam = isActive && tier === "team";
  const isPro = isActive && (tier === "pro" || tier === "team");
  const isStarter = isActive && tier === "starter";
  const limits = PLAN_LIMITS[tier];

  return {
    subscription: null as SubscriptionRow | null,
    loading,
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
    limits,
    aiAnalysesUsed,
    aiAnalysesRemaining: Infinity,
    aiAnalysesLimit: Infinity,
    aiUnlimited: true,
    bumpAiAnalysesUsed: () => setAiAnalysesUsed((n) => n + 1),
    refresh: () => fetchUsage(),
  };
}
