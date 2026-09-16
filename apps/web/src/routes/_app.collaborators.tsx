import { createFileRoute, redirect } from "@tanstack/react-router";

/*
 * Collaborators was the invited-member-facing view of the team. The Teams
 * page now renders the same reference design for everyone, so this route is
 * just an alias - old links keep working, the sidebar no longer reaches it.
 */
export const Route = createFileRoute("/_app/collaborators")({
  beforeLoad: () => {
    throw redirect({ to: "/teams" });
  },
});
