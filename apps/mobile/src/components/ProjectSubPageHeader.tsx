import type { ReactNode } from "react";
import { router, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { projectDisplayName } from "@everlumen/shared";
import { getProject } from "@/api/projects";
import { SubPageHeader } from "@/ui";

/**
 * `SubPageHeader` for a page that lives inside one project.
 *
 * Reads the project's name for the context line from the same cache key the
 * project screen fills, so it is a cache read rather than a request on the
 * way in from the tab row. It also switches the navigator's own header off,
 * because this one replaces it: two headers is the bug
 * `mobile-one-header-per-screen` exists for.
 *
 * Back pops when there is somewhere to pop to. A page opened straight from a
 * notification has nothing under it, and there Back goes to the project rather
 * than doing nothing.
 */
export function ProjectSubPageHeader({
  projectId,
  title,
  summary,
  progress,
  actions,
  children,
}: {
  projectId: string | null | undefined;
  title: string;
  summary?: string | null;
  progress?: { value: number; total: number; tone?: "primary" | "success" } | null;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const context = projectQuery.data ? projectDisplayName(projectQuery.data) : null;

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title }} />
      <SubPageHeader
        context={context}
        title={title}
        summary={summary}
        progress={progress}
        actions={actions}
        onBack={() => {
          if (router.canGoBack()) router.back();
          else if (projectId) router.replace({ pathname: "/project/[id]", params: { id: projectId } });
          else router.replace("/");
        }}
      >
        {children}
      </SubPageHeader>
    </>
  );
}
