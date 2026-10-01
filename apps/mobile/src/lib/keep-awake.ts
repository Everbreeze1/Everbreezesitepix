import { useEffect } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

/** The tag this app holds the screen on under, so it releases only its own hold. */
export const KEEP_AWAKE_TAG = "walkthrough";

/**
 * Keep the screen on while `active` is true.
 *
 * A walkthrough is recorded with the phone held out and nobody touching it, so
 * the screen's own sleep timer runs out part way round the site. When the
 * screen goes off Android closes the camera, and the recording ends there with
 * no sign until the person looks down. Held from Record until Stop, and
 * released when this unmounts, so a screen that is closed mid-walk never
 * leaves the phone unable to sleep.
 *
 * Never throws: a phone that will not hold the screen on records exactly as
 * it did before.
 */
export function useKeepAwakeWhile(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [active]);
}
