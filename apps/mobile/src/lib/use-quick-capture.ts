import { useCallback, useRef } from "react";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { listProjects, type ProjectListItem } from "@/api/projects";
import type { Coord } from "@/api/map-view";
import { pickCaptureJob } from "@/lib/capture-job";

/**
 * How long the camera button waits for a location before opening anyway.
 *
 * Short, because this is a shutter button, not a map: the last known fix is
 * instant when there is one, and when there is not the most recent job is a
 * good answer that the viewfinder's job switch corrects in one tap.
 */
const FIX_WAIT_MS = 800;

/** The phone's last known position, without asking for permission. */
async function lastKnownHere(): Promise<Coord | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const fix = await Promise.race([
      Location.getLastKnownPositionAsync(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_WAIT_MS)),
    ]);
    return fix ? { latitude: fix.coords.latitude, longitude: fix.coords.longitude } : null;
  } catch {
    return null;
  }
}

/**
 * The camera button's action: open the viewfinder straight away, on the job
 * the phone is standing at, or the one last worked on.
 *
 * It used to open a "Which job?" list first, which read as the camera button
 * taking you to Projects. The list is still one tap away as the job switch on
 * the viewfinder itself, and it is still where this falls back to when there
 * is no job to assume: no projects yet (its empty state offers New project),
 * or no list at all because the first load failed with no signal.
 *
 * The project list comes from the query cache when a screen has already loaded
 * it, so on Home the camera opens with no network round trip.
 */
export function useQuickCapture(): () => void {
  const queryClient = useQueryClient();
  const opening = useRef(false);

  return useCallback(() => {
    // Two taps on a slow phone should open one camera, not two.
    if (opening.current) return;
    opening.current = true;
    void (async () => {
      try {
        let rows = queryClient.getQueryData<ProjectListItem[]>(["projects"]);
        if (!rows) {
          rows = await queryClient
            .fetchQuery({ queryKey: ["projects"], queryFn: listProjects })
            .catch(() => undefined);
        }
        const job = rows ? pickCaptureJob(rows, await lastKnownHere()) : null;
        if (job) {
          router.push({ pathname: "/project/[id]/capture", params: { id: job.id } });
        } else {
          router.push("/capture-start");
        }
      } finally {
        opening.current = false;
      }
    })();
  }, [queryClient]);
}
