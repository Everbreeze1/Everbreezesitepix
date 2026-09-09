import { relativeTime } from "@everlumen/shared";
import type { ProjectContributor } from "@/lib/teams.functions";

/**
 * "Logged by Dana · 12 photos added · 2h ago" - or null when there is nobody
 * to credit.
 *
 * The activity line under "The field, on record". Photos only, because the
 * line sits on the photos section and the photo count is the one thing a
 * manager scanning the job needs from it. The most recent contributor leads;
 * extra names follow, then the total, then when it happened. Null instead of
 * "Logged by nobody" on a fresh job.
 *
 * Kept out of the component file so it can be tested without a renderer, and
 * so fast-refresh does not rebuild the component tree for a pure string
 * builder.
 */
export function attributionText(
  contributors: ProjectContributor[] | null | undefined,
): string | null {
  const withPhotos = (contributors ?? [])
    .filter((c) => c.photos > 0)
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  if (withPhotos.length === 0) return null;

  const total = withPhotos.reduce((sum, c) => sum + c.photos, 0);
  const first = reporterName(withPhotos[0]);
  let names: string;
  if (withPhotos.length === 1) {
    names = first;
  } else if (withPhotos.length === 2) {
    names = `${first} and ${reporterName(withPhotos[1])}`;
  } else {
    const others = withPhotos.length - 2;
    names = `${first}, ${reporterName(withPhotos[1])} and ${others} ${others === 1 ? "other" : "others"}`;
  }

  const count = `${total} ${total === 1 ? "photo" : "photos"} added`;
  const time = withPhotos[0].lastAt ? ` · ${relativeTime(withPhotos[0].lastAt)}` : "";
  return `Logged by ${names} · ${count}${time}`;
}

function reporterName(c: Pick<ProjectContributor, "fullName" | "email">): string {
  return c.fullName || c.email || "Someone";
}
