import { useEffect, useState } from "react";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { LabelsManager } from "@/features/settings/components/LabelsManager";

/**
 * Workspace labels, in Settings.
 *
 * "I was wondering if we could move Labels management out of Templates into a
 * workspace-settings area." Labels are a workspace-level catalog - the same set
 * a project picks from and a photo is tagged with - so their home is Settings,
 * not the Templates hub they happened to be filed under.
 *
 * Self-contained so Settings does not have to learn anything about labels: it
 * loads the one usage figure that matters here (how many projects use each
 * label) and hands the existing manager everything else. The "N templates"
 * badge is left off deliberately - see LabelsManager's templateUsage prop.
 */
export function WorkspaceLabelsSection({
  teamId,
  canManage,
}: {
  teamId: string | null;
  canManage: boolean;
}) {
  const { user } = useAuth();
  const [projectUsage, setProjectUsage] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      // The same read the Templates hub used for this count. RLS scopes it to
      // the projects this user can see, so the figures match what they can act
      // on.
      const { data } = await supabase.from("projects").select("labels").limit(1000);
      if (cancelled) return;
      const m = new Map<string, number>();
      for (const row of (data as Array<{ labels: string[] | null }> | null) ?? []) {
        for (const l of row.labels ?? []) {
          const k = String(l).toLowerCase();
          m.set(k, (m.get(k) ?? 0) + 1);
        }
      }
      setProjectUsage(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  return (
    <LabelsManager
      teamId={teamId}
      userId={user.id}
      canManage={canManage}
      projectUsage={projectUsage}
    />
  );
}
