/**
 * Privileged project ops via `/v1/rpc`.
 * Prefer importing from here inside the projects feature.
 */
export {
  listProjectGroups,
  createProjectGroup,
  addProjectToGroup,
  setGroupProjects,
} from "@/lib/project-groups.functions";
export {
  softDeleteProject,
  listTrashedPhotos,
  restorePhotos,
  purgePhotos,
  listTrashedProjects,
  restoreProject,
  purgeProject,
  TRASH_RETENTION_DAYS,
} from "@/lib/trash.functions";
export { combineProjects } from "@/lib/project-actions.functions";
export {
  analyzePhoto,
  extractPhotoText,
  summarizePhotosReport,
  describeSiteLogPhotos,
} from "@/lib/ai.functions";
export { generateSiteLogPdf } from "@/lib/site-log-pdf.functions";
export {
  createWalkthroughSession,
  listProjectWalkthroughs,
  saveWalkthroughPhoto,
  finishWalkthroughSession,
  ensureWalkthroughPhotoLinks,
  updateWalkthroughVideoPath,
  transcribeWalkthrough,
  generateWalkthroughReport,
  createReportFromWalkthrough,
} from "@/lib/walkthroughs.functions";
export { getProjectContributors } from "@/lib/teams.functions";
export { getMyTeam } from "@/lib/teams.functions";
