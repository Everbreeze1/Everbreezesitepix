import { personName, relativeTime } from "@everlumen/shared";

/**
 * "Logged by Dana · 12 photos added · 2h ago": who has been adding photos
 * to a job, as the web project page prints it above its photo grid
 * (`attributionText` in apps/web/src/features/projects/utils).
 *
 * A log of the work, not the crew: who is staffed is the Assign control, and
 * the web moved this out of the header precisely because a number next to
 * avatars read as a headcount.
 */

/** One row of `getProjectContributors`, in the service's own field names. */
export type ProjectContributor = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  photos: number;
  tasks: number;
  reports: number;
  lastAt: string | null;
};

/** The app's one display-name rule: the name, else the email's handle, never a raw id. */
function reporterName(c: Pick<ProjectContributor, "fullName" | "email">): string {
  return personName(c.fullName, c.email, "Someone");
}

/** The line, or null when nobody has added a photo yet. */
export function attributionText(
  contributors: readonly ProjectContributor[] | null | undefined,
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
