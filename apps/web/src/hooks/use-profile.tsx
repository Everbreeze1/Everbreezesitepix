import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";

export interface CompanyProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  company: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_logo_url: string | null;
  watermark_enabled: boolean | null;
  avatar_url: string | null;
  /**
   * Default photos per PDF page (1-4) for reports this user creates. Seeds the
   * New Report dialog and is what the unattended Auto Report reads, since that
   * one has no dialog to ask in. Nullable because a profile row written before
   * 20260821000000_report_photos_per_page_default.sql has no value yet.
   */
  report_photos_per_page: number | null;
  /**
   * The author's job title, merged into documents as `{{job_title}}` - and as
   * `{{prepared_by_title}}`, the name the same field went by first.
   * This field existed in the Settings form long before it existed here - it
   * was kept in localStorage, so it could never reach a document, a PDF, or
   * another device.
   *
   * Optional, not just nullable: a database that predates
   * 20260823000000_project_client_fields.sql does not return the column at all,
   * and the generated row types are still generated from that schema.
   */
  job_title?: string | null;
  /**
   * When this person last said "not now" to the account setup card.
   *
   * Per user rather than per team on purpose - see
   * 20260827000000_team_business_profile.sql. Optional for the same reason as
   * `job_title`: a database that predates that migration does not return the
   * column, and `useCompanySetup` reads a missing one as "never dismissed".
   */
  setup_prompt_dismissed_at?: string | null;
}

/** Clamp any stored or user-supplied density into the 1-4 the renderers accept. */
export function clampPhotosPerPage(n: number | null | undefined): 1 | 2 | 3 | 4 {
  if (typeof n !== "number" || !Number.isFinite(n)) return 2;
  return Math.min(4, Math.max(1, Math.round(n))) as 1 | 2 | 3 | 4;
}

/*
 * One store for the whole app instead of one fetch per component.
 *
 * Every consumer used to hold its own copy, so the sidebar, the header and the
 * dashboard each started at `null` and each filled in a moment later. Anything
 * that rendered a stand-in while `profile` was null - the greeting's fallback
 * name, the avatar's email - showed the stand-in first and the real value
 * second. That is the flash a user sees as "it greets me by my old name, then
 * changes to my new one".
 *
 * Two halves to removing it:
 *
 *   * a single shared fetch, so a page with three consumers resolves once; and
 *   * a snapshot of the last known row in localStorage, so the next sign-in
 *     paints the right name on the first frame rather than after a round trip.
 *
 * The snapshot is per user id and is only ever a head start: the fetch still
 * runs and replaces it. A consumer that must know whether the row is real can
 * read `loading`, which stays true until the network answers even when a
 * snapshot is already on screen.
 */

interface ProfileState {
  userId: string | null;
  profile: CompanyProfile | null;
  loading: boolean;
}

const SNAPSHOT_KEY = (userId: string) => `everlumen-profile:${userId}`;

/** How long a fetched row is reused before a newly mounted consumer refetches. */
const STALE_MS = 30_000;

let state: ProfileState = { userId: null, profile: null, loading: true };
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: ProfileState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState() {
  return state;
}

function readSnapshot(userId: string): CompanyProfile | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CompanyProfile | null;
    return parsed && parsed.id === userId ? parsed : null;
  } catch {
    return null;
  }
}

function writeSnapshot(userId: string, profile: CompanyProfile | null) {
  try {
    if (profile) localStorage.setItem(SNAPSHOT_KEY(userId), JSON.stringify(profile));
    else localStorage.removeItem(SNAPSHOT_KEY(userId));
  } catch {
    /* private mode, or a full quota - the store still works, just without the head start */
  }
}

function fetchProfile(userId: string, force: boolean): Promise<void> {
  if (inFlight && !force) return inFlight;
  const run = (async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    // Someone signed out or switched accounts while this was in the air.
    if (state.userId !== userId) return;
    if (error) {
      // Keep whatever is on screen (usually the snapshot) rather than blanking
      // the name because one request failed.
      emit({ ...state, loading: false });
      return;
    }
    const profile = (data as CompanyProfile) ?? null;
    fetchedAt = Date.now();
    writeSnapshot(userId, profile);
    emit({ userId, profile, loading: false });
  })();
  inFlight = run;
  void run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

export function useProfile() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const snapshot = useSyncExternalStore(subscribe, getState);

  // Read during render, not in the effect below: the effect runs after the
  // first paint, and the first paint is exactly the frame the flash lives in.
  const seed = useMemo(() => (userId ? readSnapshot(userId) : null), [userId]);

  useEffect(() => {
    if (!userId) {
      // Signing out forgets the head start too, so a shared machine does not
      // keep the last person's details a keypress away.
      if (state.userId) writeSnapshot(state.userId, null);
      if (state.userId !== null || state.profile !== null || state.loading) {
        fetchedAt = 0;
        emit({ userId: null, profile: null, loading: false });
      }
      return;
    }
    if (state.userId !== userId) {
      // New account in this tab: show its own snapshot, never the last one's.
      fetchedAt = 0;
      emit({ userId, profile: readSnapshot(userId), loading: true });
      void fetchProfile(userId, true);
      return;
    }
    if (Date.now() - fetchedAt > STALE_MS) void fetchProfile(userId, false);
  }, [userId]);

  const reload = useCallback(async () => {
    if (!userId) return;
    await fetchProfile(userId, true);
  }, [userId]);

  const setProfile = useCallback(
    (profile: CompanyProfile | null) => {
      if (!userId) return;
      writeSnapshot(userId, profile);
      emit({ userId, profile, loading: false });
    },
    [userId],
  );

  const mine = snapshot.userId === userId;
  const loading = mine ? snapshot.loading : userId !== null;
  const stored = mine ? snapshot.profile : null;

  return {
    // The snapshot stands in only while the row is still on its way. Once the
    // fetch has answered, a missing profile reads as missing.
    profile: stored ?? (loading ? seed : null),
    loading,
    reload,
    setProfile,
  };
}
