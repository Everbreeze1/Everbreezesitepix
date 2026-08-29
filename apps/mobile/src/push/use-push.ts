import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { notificationTarget } from "@/api/notification-target";
import { registerPushToken, unregisterPushToken } from "@/api/push-tokens";
import { pushBlocked, readPushData, type PushBlocked } from "@/api/push-view";
import { useAuth } from "@/lib/auth";

/**
 * Push notifications on this phone.
 *
 * Mounted once, from the authenticated layout. Three jobs: ask for permission,
 * register the token, and route a tap.
 *
 * The routing job is the one worth being careful about, and it is why this hook
 * does not decide anything itself. A tapped push and a tapped inbox row have to
 * land in the same place, so both go through `notificationTarget`. Two
 * independent mappings would agree on the day they were written and diverge on
 * the first route rename, and the divergence would only show on a real device
 * with a real notification, which is the hardest thing here to reproduce.
 *
 * Everything fails soft. A person who declined the permission, or is on a
 * simulator, or is running a build with no project id, gets an app that works
 * exactly as before with one row on Account explaining why push is off.
 */

/**
 * What to do with a notification that lands while the app is open.
 *
 * Shown as a banner rather than swallowed. The alternative is a notification
 * the person never sees because they happened to be looking at the app when it
 * arrived, which is the case a jobsite app hits most: the phone is in a hand,
 * not a pocket.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    // Silent. The whole crew has the app, and a chime per task assignment on a
    // site where four phones are within earshot is how people turn push off.
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/** The EAS project id, which Expo's push service needs to mint a token. */
function easProjectId(): string | null {
  const config = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return config?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

export function usePush() {
  const { user } = useAuth();
  const [blocked, setBlocked] = useState<PushBlocked>(null);
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  /**
   * Route a tap to the same place the inbox would.
   *
   * `router.push`, not `replace`: a notification opened from a cold start
   * should still leave a way back to the home screen.
   */
  const open = useCallback((raw: unknown) => {
    const data = readPushData(raw);
    const target = notificationTarget({
      type: data.type ?? "",
      linkPath: data.linkPath ?? null,
      projectId: data.projectId ?? null,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
    });
    // No target is a real answer for a workspace-level notification. The inbox
    // is the honest fallback: it is where the notification is, and it is one
    // tap from wherever it points.
    router.push(
      target ? { pathname: target.pathname as never, params: target.params } : "/notifications",
    );
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void (async () => {
      const projectId = easProjectId();
      const permission = await Notifications.getPermissionsAsync();

      let status = permission.status;
      /*
       * Only ask when the system will actually show the prompt. Both platforms
       * stop showing it after a refusal, so a second request resolves denied
       * instantly and the person sees nothing happen.
       */
      if (status === "undetermined") {
        status = (await Notifications.requestPermissionsAsync()).status;
      }

      const reason = pushBlocked({
        isDevice: Device.isDevice,
        permission:
          status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined",
        projectId,
      });
      if (cancelled) return;
      setBlocked(reason);
      if (reason) return;

      /*
       * Android needs a channel before anything is delivered, and it has to
       * exist before the first notification rather than at first receipt: one
       * created late is ignored for notifications already in flight.
       */
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Everlumen",
          importance: Notifications.AndroidImportance.DEFAULT,
          // No vibration pattern and no sound, matching the in-app handler.
          vibrationPattern: [0, 200],
          lightColor: "#f9a300",
        });
      }

      try {
        const minted = await Notifications.getExpoPushTokenAsync({ projectId: projectId! });
        if (cancelled) return;
        tokenRef.current = minted.data;
        setToken(minted.data);

        await registerPushToken({
          userId: user.id,
          token: minted.data,
          platform: Platform.OS === "ios" ? "ios" : "android",
          // Null on an emulator, and `deviceLabel` turns that into words.
          deviceName: Device.deviceName ?? null,
        });
      } catch {
        /*
         * Minting talks to Expo's servers, so this fails on a phone with no
         * signal, which is the normal state of a jobsite phone. Silent and
         * retried on the next launch: push is a convenience, and the whole app
         * must not degrade because it could not be set up.
         */
        if (!cancelled) setBlocked(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  /** Taps, whether the app was open, backgrounded, or not running. */
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data);
    });

    /*
     * A cold start from a tapped notification does not fire the listener: the
     * response was delivered before anything was subscribed. This asks for it
     * after the fact, which is the only way to catch that case.
     */
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data);
    });

    return () => subscription.remove();
  }, [open]);

  /** Stop this phone receiving. Called on sign-out. */
  const unregister = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    try {
      await unregisterPushToken(current);
    } catch {
      /*
       * Swallowed on purpose: this runs during sign-out, and a failure to
       * unregister must never block somebody from signing out. The 90-day
       * sweep in the migration collects the row eventually.
       */
    }
    tokenRef.current = null;
    setToken(null);
  }, []);

  return { blocked, token, unregister };
}
