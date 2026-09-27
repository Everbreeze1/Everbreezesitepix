import { useEffect, useState } from "react";
import * as Location from "expo-location";
import type { Coord } from "@/api/map-view";

/**
 * How long to wait for a live fix before giving up on sorting.
 *
 * Eight seconds is past the point where somebody is still looking at the list
 * wondering, and well short of the indefinite wait `getCurrentPositionAsync`
 * defaults to. Screens stay fully usable throughout: this only decides whether
 * rows get distances on them.
 */
const FIX_TIMEOUT_MS = 8000;

/**
 * Where the phone is, for "which of these jobs am I at", or null.
 *
 * Shared by the map and the capture picker. Location is a convenience for both,
 * never a requirement: it sorts a list. A screen that blocks on the permission
 * dialog would leave somebody who declined it staring at nothing.
 *
 * **`getCurrentPositionAsync` can hang forever, and on a jobsite it does.**
 * It resolves when the device gets a fix, and a phone in a basement, a
 * steel-framed building or an emulator with no GPS never gets one: it does
 * not throw, it simply never settles. The first version of the map awaited it
 * bare, so the list silently never sorted AND never showed the line explaining
 * why. So: take the cached fix first, which is instant when there is one, and
 * race the live read against a timer.
 *
 * `noFix` is true when there is no usable fix at all (denied, switched off, or
 * no signal before the deadline), so the screen can say why the list is not
 * sorted by distance rather than leaving it to look sorted when it is not.
 */
export function useDeviceLocation(): { here: Coord | null; noFix: boolean } {
  const [here, setHere] = useState<Coord | null>(null);
  const [noFix, setNoFix] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== "granted") {
          setNoFix(true);
          return;
        }

        /*
         * The last known fix, first. It returns immediately or not at all, and
         * for "which of these sites am I at" a fix from ten minutes ago is the
         * same answer as one from now.
         */
        const cached = await Location.getLastKnownPositionAsync();
        if (cancelled) return;
        if (cached) {
          setHere({ latitude: cached.coords.latitude, longitude: cached.coords.longitude });
        }

        /*
         * Then the live one, against a deadline.
         *
         * `Balanced` and not `Highest`: this picks which of several sites you
         * are at, which is a hundred-metre question, and the high-accuracy fix
         * costs seconds and battery to answer it no better.
         */
        const fix = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
          }),
        ]);
        if (cancelled) return;

        if (fix) {
          setHere({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
        } else if (!cached) {
          setNoFix(true);
        }
      } catch {
        // Location switched off at the OS level throws rather than returning a
        // status. Same outcome: no sorting, everything else works.
        if (!cancelled) setNoFix(true);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { here, noFix };
}
