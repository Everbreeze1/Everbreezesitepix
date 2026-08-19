/** Project feature shared types. */

export interface Project {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status: string;
  /**
   * Position in a pipeline, single-select. Distinct from `status`, which is the
   * Active/Completed/Archived bucket, and from `tags`, which stopped doubling
   * as pipeline columns in 20260917000000_pipeline_stages.sql. NULL means the
   * project is in no pipeline.
   */
  pipeline_stage_id?: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  labels?: string[] | null;
  completed_at?: string | null;
}
export interface Photo {
  id: string;
  storage_path: string;
  /** Pre-generated thumbnail; null for photos uploaded before they existed. */
  thumb_path?: string | null;
  image_url: string | null;
  caption: string | null;
  phase: string | null;
  tags: string[];
  created_at: string;
  taken_at: string | null;
  latitude: number | null;
  longitude: number | null;
  hidden?: boolean | null;
}

export interface Report {
  id: string;
  photo_id: string;
  report_text: string | null;
  defects: Array<{ severity: string; type: string; description: string }> | null;
  created_at: string;
}
