import NetInfo from "@react-native-community/netinfo";
import { AppState, type AppStateStatus } from "react-native";
import { queryClient } from "@/lib/query";
import { handlerFor, isPermanent } from "./handlers";
import { flushCaptureSessions } from "./capture-session";
import {
  claimNext,
  counts,
  markDone,
  markFailed,
  recoverInterrupted,
  sweepOrphanedMedia,
  type OutboxCounts,
  type OutboxRow,
} from "./outbox";

/**
 * Drives the outbox: decides when to try, and works through what is due.
 *
 * Everything here assumes the network is the unreliable part. Nothing throws
 * out of the drain, no failure stops the loop, and no state lives only in
 * memory, because the process can be killed between any two lines.
 */

type Listener = (counts: OutboxCounts) => void;

const listeners = new Set<Listener>();
let latest: OutboxCounts = { pending: 0, sending: 0, failed: 0, outstanding: 0 };
let draining = false;
let online = true;
let started = false;
/** Set when a trigger fires mid-drain, so the loop runs again rather than racing. */
let rerun = false;

export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener);
  listener(latest);
  return () => listeners.delete(listener);
}

/**
 * Drop the cached answer a refused write was optimistically showing.
 *
 * Every queued mutation updates the cache before it is sent, which is what
 * makes the app usable with no signal. When the server then refuses the write
 * for good, that optimistic value is a lie the user has no way to spot: the tick
 * stays ticked, the task stays done, and the only hint is a number in a banner.
 *
 * Rows carry the query keys their optimistic update touched, so a permanent
 * failure can put the real state back on screen.
 */
function invalidateFor(payload: string) {
  try {
    const parsed = JSON.parse(payload) as { invalidate?: unknown[][] };
    if (!Array.isArray(parsed.invalidate)) return;
    for (const queryKey of parsed.invalidate) {
      if (Array.isArray(queryKey)) void queryClient.invalidateQueries({ queryKey });
    }
  } catch {
    // A payload that will not parse is already failing for a better reason.
  }
}

async function publish() {
  latest = await counts();
  for (const listener of listeners) listener(latest);
}

/**
 * Work through everything currently due, then stop.
 *
 * Rows are taken one at a time. Uploading several photos at once from a phone
 * on site does not go faster: it splits the same thin uplink between them, and
 * makes every one of them slower to finish, so a queue that is interrupted
 * halfway has nothing complete to show for it.
 *
 * A project whose row fails is parked for the rest of the pass, so the next
 * claim moves on to a different job instead of retrying the same bad row.
 */
async function drain(): Promise<void> {
  if (draining) {
    rerun = true;
    return;
  }
  draining = true;

  try {
    do {
      rerun = false;
      const parked: string[] = [];

      for (;;) {
        if (!online) break;

        let row: OutboxRow | null = null;
        try {
          row = await claimNext(parked);
        } catch {
          // The local database is unavailable. Nothing useful to do but wait
          // for the next trigger.
          break;
        }
        if (!row) break;

        const handler = handlerFor(row.kind);
        if (!handler) {
          await markFailed(row, `No handler for ${row.kind}`, true);
          continue;
        }

        try {
          await handler(row);
          await markDone(row);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed";
          const permanent = isPermanent(error);
          await markFailed(row, message, permanent);
          if (permanent) invalidateFor(row.payload);
          // Park this project for the rest of the pass. Its next row is very
          // likely to fail the same way, and other jobs are waiting.
          parked.push(row.project_id ?? "");
        }

        await publish();
      }
    } while (rerun);

    await sweepOrphanedMedia();

    /*
     * Last, and only once the queue has gone quiet. A session is finished when
     * its photos have all landed or all given up, which is a question only
     * answerable after a pass rather than during one.
     */
    await flushCaptureSessions();
  } finally {
    draining = false;
    await publish();
  }
}

/** Ask the queue to run. Safe to call from anywhere, as often as you like. */
export function requestSync(): void {
  void drain();
}

/**
 * Begin listening for the moments worth retrying on.
 *
 * There is no timer here. A queue that wakes on a schedule spends battery
 * discovering that the phone is still in a basement; these are the four events
 * after which the answer might actually have changed.
 */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;

  // Anything left in `sending` belongs to a process that is gone.
  await recoverInterrupted().catch(() => 0);
  await publish().catch(() => {});

  NetInfo.addEventListener((state) => {
    const nowOnline = Boolean(state.isConnected) && state.isInternetReachable !== false;
    const regained = nowOnline && !online;
    online = nowOnline;
    if (regained) requestSync();
  });

  AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active") requestSync();
  });

  const state = await NetInfo.fetch().catch(() => null);
  if (state) {
    online = Boolean(state.isConnected) && state.isInternetReachable !== false;
  }

  requestSync();
}

/** Current counts without subscribing, for a one-off read. */
export function queueSnapshot(): OutboxCounts {
  return latest;
}

/** Recount from the database, after a change made outside the drain. */
export async function refreshQueue(): Promise<void> {
  await publish().catch(() => {});
}
