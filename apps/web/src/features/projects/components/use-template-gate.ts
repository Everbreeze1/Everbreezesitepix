import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useSubscription } from "@/hooks/use-subscription";

/**
 * Templates are a Pro and Team feature. Starter builds its documents and
 * reports by hand.
 *
 * Settings > Templates has enforced this since it existed (`gated = !isPro`),
 * but the pickers that *consume* templates did not: "Apply template" on the
 * Reports tab and "More Templates" in the Create document menu both read
 * `document_templates` for anyone. So the plan boundary held wherever a user
 * would author a template and leaked wherever they would use one.
 *
 * One hook so the boundary and the wording cannot drift between the three
 * places that ask.
 *
 * `locked` is false while the plan is still loading: `isPro` reads false during
 * the team query, and a Pro account should not watch its own templates appear
 * padlocked for a frame before unlocking.
 */
export function useTemplateGate() {
  const { isPro, loading } = useSubscription();
  const navigate = useNavigate();

  const locked = !isPro && !loading;

  function promptUpgrade() {
    toast.message("Templates are on Pro and Team", {
      description:
        "Starter builds documents and reports by hand, with every layout control still available.",
      action: { label: "See plans", onClick: () => navigate({ to: "/pricing" }) },
    });
  }

  return { locked, promptUpgrade };
}
