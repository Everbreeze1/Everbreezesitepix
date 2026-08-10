import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LayoutTemplate } from "lucide-react";
import { supabase } from "@/integrations/sitepix/client";

interface Origin {
  blueprintId: string;
  name: string;
  count: number;
}

/**
 * "Set up from <blueprint>" on the project hero.
 *
 * The blueprint → project link only ran one way: you could apply a blueprint
 * and then never tell, from the project, that a blueprint was why any of this
 * exists. This closes the loop from the project end and gives the crew a route
 * back to the thing they should edit if the setup is wrong.
 *
 * Renders nothing when the project was not set up from a blueprint — or when
 * the ledger table is not present yet (migration 20260810000000).
 */
export function ProjectBlueprintOrigin({ projectId }: { projectId: string }) {
  const [origin, setOrigin] = useState<Origin | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("project_blueprint_applications" as any)
        .select("blueprint_id, created_at, project_templates(name)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (cancelled || error) return;
      const rows = ((data as any[]) ?? []) as Array<{
        blueprint_id: string;
        project_templates: { name: string } | null;
      }>;
      if (!rows.length) {
        setOrigin(null);
        return;
      }
      // The first apply is the one that set the project up; later ones are
      // additions. Naming the first keeps the label stable as more are applied.
      const first = rows[0];
      setOrigin({
        blueprintId: first.blueprint_id,
        name: first.project_templates?.name ?? "a blueprint",
        count: rows.length,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!origin) return null;

  return (
    <Link
      to="/templates"
      search={{ tab: "blueprints", blueprint: origin.blueprintId }}
      className="inline-flex items-center gap-2 rounded-md transition hover:text-sidebar-foreground"
      title={
        origin.count > 1
          ? `${origin.count} blueprints have been applied to this project`
          : "Open this blueprint"
      }
    >
      <LayoutTemplate className="h-4 w-4 text-sidebar-ring" />
      Set up from {origin.name}
      {origin.count > 1 ? ` +${origin.count - 1}` : ""}
    </Link>
  );
}
