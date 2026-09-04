import { can } from "@everlumen/shared/team-permissions";
import { useSubscription } from "@/hooks/use-subscription";
import { useTeamMembers } from "@/hooks/use-team-members";

/**
 * Reusable templates and project checklist/workflow structure are account-admin
 * tools. Pro and Team unlock them; Owner, Admin and Manager may author them.
 * Crew can still run records that an author has put on a project.
 */
export function useTemplateAuthoringAccess() {
  const { myRole, isLoading: teamLoading } = useTeamMembers();
  const { isPro, loading: subscriptionLoading } = useSubscription();

  // Solo owners do not have a team_members row, so null means the account owner
  // here, matching the existing Templates hub behavior.
  const roleAllows = !myRole || can(myRole, "manage_templates");

  return {
    canAuthor: isPro && roleAllows,
    isPaid: isPro,
    roleAllows,
    loading: teamLoading || subscriptionLoading,
  };
}
