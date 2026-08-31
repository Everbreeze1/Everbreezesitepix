import { z } from "zod";
import { allPhotoObjectPaths } from "@everlumen/shared";
import { chunk } from "../../lib/chunked-in";
import { getSupabaseAdmin } from "../../lib/supabase";
import { logAdminAction } from "../admin/audit";
import type { AuthedContext } from "../../lib/user-context";

/**
 * Closing your own account.
 *
 * **This exists because a store requires it.** Google Play has required an
 * in-app or web-reachable account deletion route since 2024, and a support
 * email address has been rejected at review. There was no self-service path at
 * all: `deletePlatformUser` is staff-only and explicitly refuses to delete the
 * caller's own account.
 *
 * Deletion is `auth.admin.deleteUser`, which cascades through every table whose
 * foreign key to `auth.users` is `ON DELETE CASCADE`. That is most of them, and
 * it is why this is service-role work rather than a client write.
 *
 * The confirmation is the typed email address, matching the staff path. A
 * checkbox is not a confirmation for something irreversible: typing the address
 * is the difference between deciding and mis-tapping.
 */

export const deleteMyAccountInputSchema = z.object({
  /** Must match the caller's own address, case-insensitively. */
  confirmEmail: z.string().trim().min(3).max(200),
});

/**
 * Why an account cannot be closed yet, or null.
 *
 * Exported and pure so the phone and the web can both ask before offering the
 * button, and so the one awkward case is testable without deleting anybody.
 *
 * **The awkward case is an owner with teammates**, and it is a real product gap
 * rather than a rule. Ownership cannot be transferred: `updateMemberRole`
 * accepts admin, manager, standard and restricted, and there is no
 * `transferOwnership` or `deleteTeam` op anywhere. So an owner today can neither
 * leave (`leaveTeam` refuses them), nor hand the workspace on, nor take it with
 * them. Deleting them anyway would orphan a workspace their colleagues are
 * still working in, which is worse than refusing.
 *
 * A sole owner is fine: there is nobody to orphan.
 */
export function accountDeletionBlockedReason(
  role: string | null,
  otherMemberCount: number,
): string | null {
  if (role === "owner" && otherMemberCount > 0) {
    return "You own a workspace that other people are still working in, and ownership cannot be transferred yet. Contact support and we will move it before closing your account.";
  }
  return null;
}

export async function deleteMyAccountService(
  ctx: AuthedContext,
  data: z.infer<typeof deleteMyAccountInputSchema>,
): Promise<{ ok: true }> {
  const admin = getSupabaseAdmin();

  const { data: authUser } = await admin.auth.admin.getUserById(ctx.userId);
  const email = ((authUser?.user as { email?: string } | undefined)?.email ?? "").trim();
  if (!email) throw new Error("This account has no email address on file.");

  if (data.confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
    throw new Error("The typed email does not match this account. Nothing was deleted.");
  }

  /*
   * The ownership check, read fresh rather than trusted from the client. The
   * phone asks the same question to decide whether to offer the button, and a
   * client that answered it wrongly would otherwise delete an owner.
   */
  const { data: membership } = await (admin as never as ReturnType<typeof getSupabaseAdmin>)
    .from("team_members" as never)
    .select("team_id, role")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  const row = membership as { team_id?: string; role?: string } | null;
  let otherMembers = 0;
  if (row?.team_id) {
    const { count } = await (admin as never as ReturnType<typeof getSupabaseAdmin>)
      .from("team_members" as never)
      .select("user_id", { count: "exact", head: true })
      .eq("team_id", row.team_id)
      .neq("user_id", ctx.userId);
    otherMembers = count ?? 0;
  }

  const blocked = accountDeletionBlockedReason(row?.role ?? null, otherMembers);
  if (blocked) throw Object.assign(new Error(blocked), { status: 409 });

  /*
   * Logged before the delete, like the staff path, and for the same reason: the
   * audit row references the actor, who is about to stop existing, so it is
   * written first and deliberately carries the email rather than only the id.
   * After the cascade the id resolves to nothing.
   */
  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: "delete_own_account",
    targetType: "user",
    targetId: ctx.userId,
    metadata: { email, teamId: row?.team_id ?? null, role: row?.role ?? null },
  });

  /*
   * Their storage objects, removed BEFORE the auth user goes.
   *
   * `projects.created_by` cascades on user delete, and `photos` cascades from
   * `projects`, so the rows disappear on their own. The files do not: nothing
   * in Supabase links a storage object to a database row, so deleting the user
   * left every jobsite photograph sitting in `site-photos` permanently, with
   * nothing left pointing at it. Unfindable, and impossible to clean up
   * afterwards precisely because the rows that named the paths are gone.
   *
   * So the paths are collected while the rows still exist. Order matters and
   * this is the only order that works.
   *
   * Best-effort on the storage call itself, and deliberately: a storage failure
   * must not leave somebody unable to close their account. An orphaned file is
   * a problem to sweep later; a person who cannot leave is a promise broken.
   */
  let filesRemoved = 0;
  try {
    /*
     * Scoped to projects they created, and only those.
     *
     * The reasoning: a photo they took in a teammate's project should keep its
     * row and stay that project's evidence. Removing its file here would delete
     * a colleague's site record out from under them because of who happened to
     * be holding the phone. So the files that go are the ones whose rows go,
     * which are the ones cascading from `projects.created_by`.
     *
     * !! UNVERIFIED ASSUMPTION: that `photos.uploaded_by` is ON DELETE SET NULL.
     *
     * `public.photos` is not created by any migration in this repo - it predates
     * them - so the constraint cannot be read from the code, and the live schema
     * is known to carry columns no migration declares. The assumption cannot be
     * checked by test either: the scoping is what the tests assert, not the
     * constraint underneath it.
     *
     * It matters in both directions, which is why it needs settling rather than
     * assuming:
     *
     *   SET NULL  - correct as written.
     *   CASCADE   - deleting this user also deletes their photo ROWS from
     *               teammates' projects, destroying a colleague's evidence, and
     *               leaves those files orphaned because this block never
     *               collected their paths.
     *
     * Settle it with:
     *
     *   SELECT confdeltype FROM pg_constraint
     *   WHERE conrelid = 'public.photos'::regclass
     *     AND confrelid = 'auth.users'::regclass;
     *
     * 'n' is SET NULL and this code is right. 'c' is CASCADE and this block has
     * to widen to cover photos they uploaded anywhere, because those rows are
     * going regardless and only the files would be left behind.
     */
    const { data: projectRows } = await admin
      .from("projects")
      .select("id")
      .eq("created_by", ctx.userId);

    const projectIds = (projectRows ?? []).map((row) => row.id);

    const photoRows: { storage_path: string; thumb_path: string | null }[] = [];
    for (const ids of chunk(projectIds)) {
      const { data } = await admin
        .from("photos")
        .select("storage_path, thumb_path")
        .in("project_id", ids);
      photoRows.push(...((data as typeof photoRows | null) ?? []));
    }

    // Each photo owns two objects: the original and its stored thumbnail.
    const paths = allPhotoObjectPaths(photoRows);
    for (const batch of chunk(paths)) {
      const { error: removeError } = await admin.storage.from("site-photos").remove(batch);
      if (removeError) {
        console.error("[delete-account] storage remove failed", removeError.message);
        continue;
      }
      filesRemoved += batch.length;
    }
  } catch (e: unknown) {
    console.error(
      "[delete-account] could not clear storage",
      e instanceof Error ? e.message : String(e),
    );
  }

  const { error } = await admin.auth.admin.deleteUser(ctx.userId);
  if (error) throw new Error(error.message);

  console.info(`[delete-account] closed ${ctx.userId}, removed ${filesRemoved} storage objects`);
  return { ok: true };
}
