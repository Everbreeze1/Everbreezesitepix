import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";

export interface SubscriptionRow {
  id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

// Payments have been removed from this build. No one has an active
// subscription, so every gated feature stays locked. The hook keeps the
// same shape so existing call sites (UpgradeDialog triggers, watermark
// guards, etc.) continue to work without changes.
export const PLAN_LIMITS = {
  starter: { storageBytes: 50 * 1024 ** 3 }, // 50 GB
  team: { storageBytes: 200 * 1024 ** 3 }, // 200 GB
} as const;

// Owner/admin emails that always get full access, independent of billing.
// Case-insensitive; whitespace-trimmed. Add additional owner addresses here.
const OWNER_EMAILS = new Set<string>(["ajmalllo@icloud.com"]);

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function useSubscription() {
  const { user, loading: authLoading } = useAuth();
  const [aiAnalysesUsed, setAiAnalysesUsed] = useState(0);
  const [isDbAdmin, setIsDbAdmin] = useState(false);

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

  // Check admin role from user_roles table — owner/admin always gets full access.
  useEffect(() => {
    if (!user) {
      setIsDbAdmin(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!cancelled) setIsDbAdmin(!!data);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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

  const tier = "starter" as "starter" | "team";
  const limits = PLAN_LIMITS.starter;

  // Owner/admin bypass — grants full access to all gated features (walkthroughs,
  // auto-reports, watermark, team, etc.) regardless of billing tier.
  const emailNorm = normalizeEmail(user?.email);
  const isOwner = !!emailNorm && OWNER_EMAILS.has(emailNorm);
  const isTestAccount = isOwner || isDbAdmin;

  return {
    subscription: null as SubscriptionRow | null,
    loading: authLoading,
    isActive: isTestAccount,
    isTrialing: false,
    trialDaysRemaining: 0,
    trialEndsAt: null as Date | null,
    planName: isTestAccount ? "Team (Test)" : "Inactive",
    tier: isTestAccount ? ("team" as const) : tier,
    isStarter: !isTestAccount,
    isPro: isTestAccount,
    isTeam: isTestAccount,
    canUseAiChat: true,
    canAttachPhotoInChat: isTestAccount,
    canUseTeamFeatures: isTestAccount,
    canUseWatermark: isTestAccount,
    canUseWalkthroughs: isTestAccount,
    limits: isTestAccount ? PLAN_LIMITS.team : limits,
    aiAnalysesUsed,
    aiAnalysesRemaining: Infinity,
    aiAnalysesLimit: Infinity,
    aiUnlimited: true,
    bumpAiAnalysesUsed: () => setAiAnalysesUsed((n) => n + 1),
    refresh: () => fetchUsage(),
  };
}
