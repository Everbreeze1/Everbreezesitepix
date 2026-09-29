import { api } from "@/lib/api";
import type { ProjectContributor } from "./project-contributors-view";

/**
 * Who has added work to a job, for the project page's "Logged by" line: the
 * web project page's `getProjectContributors` call, read in full (photo, task
 * and report counts per person, and when they last added something).
 */
export async function getProjectContributorLog(projectId: string): Promise<ProjectContributor[]> {
  const result = await api.rpc<{ contributors?: ProjectContributor[] }>("getProjectContributors", {
    projectId,
  });
  return result?.contributors ?? [];
}
