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
