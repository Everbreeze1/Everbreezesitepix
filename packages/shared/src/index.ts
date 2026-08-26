export { relativeTime } from "./relative-time";
export {
  parseCalendarDate,
  todayCalendarDate,
  startOfLocalDay,
  calendarDaysFromToday,
  isCalendarDateOverdue,
  formatCalendarDate,
  calendarDueLabel,
  isPlausibleCalendarDate,
  MIN_PLAUSIBLE_YEAR,
  MAX_PLAUSIBLE_YEAR,
  type DueLabel,
} from "./calendar-date";
export {
  isFilenameLikeCaption,
  cleanCaption,
  sanitizeCaption,
  displayCaption,
  formatPhotoDate,
  formatPhotoDateGroup,
} from "./photo-caption";
export {
  parseRich,
  richIsEmpty,
  richToPlainText,
  type InlineRun,
  type RichBlock,
} from "./report-rich";
export { markdownToHtml, markdownToRich } from "./markdown-rich";
export { cleanWalkthroughMarkdown, walkthroughSummaryBlocks } from "./walkthrough-summary";
export {
  REPORT_PAGE,
  splitOnPageBreak,
  planSectionPages,
  type SectionPagePlan,
} from "./report-pagination";
export { normalizeDashes, normalizeDashesTrimmed } from "./machine-dashes";
export {
  NOTIFICATION_PREF_DEFAULTS,
  NOTIFICATION_TYPE_PREF,
  prefEnabled,
  emailAllowed,
  parseNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefKey,
} from "./notification-prefs";
export { labelColor, labelChipClass } from "./label-colors";
export {
  thumbPathFor,
  isThumbPath,
  thumbPathsFor,
  photoObjectPaths,
  allPhotoObjectPaths,
} from "./photo-thumbnails";
export {
  CHECKLIST_TYPE_LABELS,
  WORKFLOW_KIND_LABELS,
  hasFieldResponse,
  formatChecklistAnswer,
  formatProjectAddress,
  type ChecklistItemType,
  type WorkflowItemKind,
} from "./field-records";
export {
  parseReportTemplateStructure,
  type ReportCoverStyle,
  type ReportSectionLayout,
  type ReportTemplateSection,
  type ReportTemplateStructure,
} from "./report-template-structure";
export {
  REPORT_STARTERS,
  getReportStarter,
  type ReportStarter,
  type ReportStarterCategory,
  type ReportStarterCover,
} from "./report-starters";
export {
  MAX_AUTO_REPORT_PHOTO_SECTIONS,
  consolidateReportSections,
  type DraftReportSection,
} from "./report-autostructure";
export {
  buildTaskReportSection,
  buildTaskReportSections,
  taskReportProgress,
  type TaskForReport,
  type TaskPhotoStateForReport,
  type TaskReportOptions,
  type TaskReportSection,
  type TaskReportStatus,
} from "./report-task-sections";
export {
  INDUSTRIES,
  INDUSTRY_IDS,
  TEAM_SIZES,
  TEAM_SIZE_IDS,
  PROJECT_VOLUMES,
  PROJECT_VOLUME_IDS,
  COMPANY_GOALS,
  COMPANY_GOAL_IDS,
  HEARD_FROM,
  HEARD_FROM_IDS,
  findIndustry,
  industryLabel,
  tradeCategoryFor,
  recommendedCategories,
  choiceLabel,
  isBusinessProfileComplete,
  type Industry,
  type Choice,
  type BusinessProfile,
} from "./industries";
export {
  PHOTO_ROW_WIDTH,
  PHOTO_ROW_HEIGHT,
  photoWidthFor,
  photoRows,
  photoPageGroups,
  type PhotoRowMode,
} from "./photo-row-layout";
export {
  humanizeServiceType,
  normalizeExternalUrl,
  serviceAreaKey,
  mergeServiceArea,
  looksLikeStreetAddress,
  withoutStreetAddress,
} from "./portfolio-fields";
export {
  DEFAULT_PIPELINE_STAGES,
  PIPELINE_STAGE_COLORS,
  MAX_PIPELINE_STAGES,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  defaultStatusForStageName,
  isProjectStatus,
  isScheduledStageName,
  nextPipelineStageColor,
  normalizePipelineName,
  samePipelineName,
  pipelineNameIssue,
  pipelineNameBlocks,
  pipelineNameMessage,
  type PipelineStageSeed,
  type PipelineNameIssue,
  type ProjectStatus,
} from "./pipeline-stages";
export {
  UNTITLED_PROJECT,
  projectDisplayName,
  describeProjects,
  newProjectName,
  type ProjectNameFields,
  type DescribedProject,
} from "./project-name";
export {
  TASK_PHOTO_ITEMS_TABLE,
  TASK_PHOTO_ITEM_COLUMNS,
  indexTaskPhotoItems,
  isMissingTaskPhotoItems,
  taskPhotoItemErrorMessage,
  taskPhotoIds,
  taskPhotoProgress,
  taskStatusFromPhotos,
  photoIsDone,
  photoPositionInTask,
  taskWorkSummary,
  taskPhotoItemPatch,
  taskPhotoItemRows,
  type TaskPhotoStatus,
  type TaskPhotoItem,
  type TaskPhotoItemIndex,
  type TaskPhotoProgress,
  type TaskWorkSummary,
} from "./task-photo-items";
