import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";

export interface CompanyProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  company: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_logo_url: string | null;
  watermark_enabled: boolean | null;
  avatar_url: string | null;
  /**
   * Default photos per PDF page (1-4) for reports this user creates. Seeds the
   * New Report dialog and is what the unattended Auto Report reads, since that
   * one has no dialog to ask in. Nullable because a profile row written before
   * 20260821000000_report_photos_per_page_default.sql has no value yet.
   */
  report_photos_per_page: number | null;
}

/** Clamp any stored or user-supplied density into the 1-4 the renderers accept. */
export function clampPhotosPerPage(n: number | null | undefined): 1 | 2 | 3 | 4 {
  if (typeof n !== "number" || !Number.isFinite(n)) return 2;
  return Math.min(4, Math.max(1, Math.round(n))) as 1 | 2 | 3 | 4;
}

export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    setProfile((data as CompanyProfile) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  return { profile, loading, reload: load, setProfile };
}
