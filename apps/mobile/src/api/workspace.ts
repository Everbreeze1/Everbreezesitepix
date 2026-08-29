import { api } from "@/lib/api";
import type { BusinessProfile } from "@everlumen/shared";

/**
 * Workspace settings: the company behind the projects.
 *
 * `saveCompanyProfile` is a **partial** patch and that is load-bearing. The web
 * setup wizard saves one step at a time, so the op means "change these fields"
 * and not "these are all the answers now". Sending the whole profile on every
 * edit would let this screen overwrite an answer somebody gave on the web
 * between the read and the write, and there is no reason to: a phone edits one
 * field at a time too.
 *
 * `null` is meaningful and separate from absent. Omitting `service_area` leaves
 * it alone; sending `null` clears it.
 */

export type CompanyProfilePatch = {
  companyName?: string;
  industry?: string | null;
  trades?: string[];
  team_size?: string | null;
  project_volume?: string | null;
  goals?: string[];
  heard_from?: string | null;
  service_area?: string | null;
};

export async function saveCompanyProfile(patch: CompanyProfilePatch): Promise<void> {
  await api.rpc("saveCompanyProfile", patch);
}

/**
 * The profile as it comes back on the team row from `getMyTeam`.
 *
 * Snake case throughout because these are database columns and `getMyTeam`
 * returns the row untouched. Renaming them on the way in would mean renaming
 * them again on the way out, since the patch above takes the column names.
 */
export type TeamProfileRow = Partial<BusinessProfile> & {
  name?: string | null;
};
