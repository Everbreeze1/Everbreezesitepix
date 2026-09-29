import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { parseNotificationPrefs, type NotificationPrefs } from "@everlumen/shared";
import { supabase } from "@/lib/supabase";

/**
 * The signed-in person's own profile, as the web Settings page reads and
 * writes it.
 *
 * Direct RLS reads and writes on `profiles`, which lets a person see and change
 * their own row and nobody else's: the same calls the web makes, so a change on
 * one surface is the value the other shows.
 */

export type MyProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  job_title: string | null;
  avatar_url: string | null;
  notification_prefs: NotificationPrefs;
};

export async function getMyProfile(userId: string): Promise<MyProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, job_title, avatar_url, notification_prefs")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as
    | (Omit<MyProfile, "notification_prefs"> & { notification_prefs: unknown })
    | null;
  return {
    id: userId,
    email: row?.email ?? null,
    full_name: row?.full_name ?? null,
    job_title: row?.job_title ?? null,
    avatar_url: row?.avatar_url ?? null,
    notification_prefs: parseNotificationPrefs(row?.notification_prefs),
  };
}

/**
 * Name and job title.
 *
 * An upsert on the id, as the web does, so an account whose profile row was
 * never created still ends up with one. The auth copy of the name is kept in
 * step afterwards: sign-up writes it once and nothing ever rewrote it, so a
 * renamed account kept greeting people by the old name anywhere that only had
 * the session to read (the home screen's greeting is one).
 */
export async function saveMyProfile(args: {
  userId: string;
  email: string | null;
  fullName: string;
  jobTitle: string;
}): Promise<void> {
  const fullName = args.fullName.trim() || null;
  const { error } = await supabase.from("profiles").upsert(
    {
      id: args.userId,
      email: args.email,
      full_name: fullName,
      job_title: args.jobTitle.trim() || null,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
  if (fullName) {
    // Best effort: the profile row is the record, so a failure here is not
    // worth failing the save over.
    await supabase.auth.updateUser({ data: { full_name: fullName } }).catch(() => {});
  }
}

/** Longest edge of an uploaded avatar. It is drawn at 64pt at most. */
const AVATAR_DIM = 512;

/**
 * Upload a new avatar and point the profile at it.
 *
 * Same bucket and path shape as the web (`company-logos/<uid>/avatar-<ts>`),
 * which is public, so the URL on the row is a plain public URL that every
 * surface can draw without signing. Downscaled first: a phone photo is 4MB and
 * the avatar is a circle the size of a thumbnail.
 */
export async function uploadMyAvatar(userId: string, uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: AVATAR_DIM });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const bytes = await new File(saved.uri).arrayBuffer();

  const path = `${userId}/avatar-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("company-logos")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploadError) throw new Error(uploadError.message);

  const { data } = supabase.storage.from("company-logos").getPublicUrl(path);
  const url = data.publicUrl;
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) throw new Error(error.message);
  return url;
}

/**
 * Write the whole preferences object, as the web does on every toggle.
 *
 * `profiles.notification_prefs` is what the email sender reads, so this is a
 * real preference and not a local one: switching "Tasks assigned to me" off
 * here stops the email, from either surface.
 */
export async function saveNotificationPrefs(
  userId: string,
  prefs: NotificationPrefs,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    // Spread into a plain record: the interface has no index signature, and
    // the column's generated type is JSON.
    .update({ notification_prefs: { ...prefs } as Record<string, boolean | undefined> })
    .eq("id", userId);
  if (error) {
    throw new Error(
      /notification_prefs/.test(error.message)
        ? "Notification preferences need the latest database migration."
        : error.message,
    );
  }
}

/** Minimum password length, the web's rule. */
export const MIN_PASSWORD = 8;

/** Why a new password cannot be saved, or null when it can. */
export function passwordProblem(next: string, confirm: string): string | null {
  if (next.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (next !== confirm) return "The two passwords do not match.";
  return null;
}

/**
 * Start an email change. Supabase sends a confirmation to the new address and
 * the change only takes effect once it is followed, so the caller says that
 * rather than "saved".
 */
export async function changeMyEmail(next: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email: next.trim().toLowerCase() });
  if (error) throw new Error(error.message);
}

export async function changeMyPassword(next: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) throw new Error(error.message);
}
