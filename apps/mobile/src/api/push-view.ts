/**
 * Push, as rules rather than as a side effect.
 *
 * Import-free so the parts that decide *what happens* can be tested, because
 * none of them can be exercised on a simulator: `expo-notifications` refuses to
 * mint a token without real hardware, so the only way to check this logic
 * before it ships to a phone is to test it directly.
 */

/**
 * Whether registering is even possible here.
 *
 * Four separate reasons it might not be, and they want different words. A
 * simulator cannot receive push at all, which is not a problem to fix. A denied
 * permission is the person's decision and is reversible in Settings. A missing
 * project id is a build misconfiguration and is ours. And `unavailable` is the
 * one the caller sets rather than this function: registration was attempted and
 * failed, usually because the device could not reach Expo's push service.
 */
export type PushBlocked = "simulator" | "denied" | "no_project_id" | "unavailable" | null;

export function pushBlocked(opts: {
  isDevice: boolean;
  permission: "granted" | "denied" | "undetermined";
  projectId: string | null | undefined;
}): PushBlocked {
  // Checked first because it is the only one that cannot be resolved. Asking
  // for permission on a simulator succeeds and then fails to mint a token,
  // which reads as a bug rather than as a limitation.
  if (!opts.isDevice) return "simulator";
  if (!opts.projectId) return "no_project_id";
  if (opts.permission !== "granted") return "denied";
  return null;
}

/** What the Account row says about push on this phone. */
export function pushStatusLabel(blocked: PushBlocked, registered: boolean): string {
  switch (blocked) {
    case "simulator":
      return "Not available on a simulator";
    case "denied":
      return "Turned off in your phone settings";
    case "no_project_id":
      // Ours, not theirs. Saying "turned off" here would send somebody into
      // Settings to fix something that is not there.
      return "This build cannot receive push";
    case "unavailable":
      /*
       * Tried, and could not. Distinct from "Setting up" because that reads as
       * in-progress: a registration that failed once used to sit on "Setting
       * up" forever, which is a screen telling somebody something is happening
       * when nothing is. It retries on the next launch, so say that.
       */
      return "Could not set up on this phone. It will try again next launch.";
    default:
      return registered ? "On for this phone" : "Setting up";
  }
}

/**
 * Whether asking again is worth it.
 *
 * Android and iOS both stop showing the system prompt after the first refusal,
 * so a second `requestPermissions` call resolves denied instantly and looks
 * like a dead button. Only `undetermined` is worth prompting on; a denial has
 * to be reversed in Settings, and the caller says so.
 */
export function canPrompt(permission: string, canAskAgain: boolean): boolean {
  return permission === "undetermined" || canAskAgain;
}

/**
 * A name for this phone in the device list.
 *
 * `expo-device` returns null on an emulator and can return a model code rather
 * than a name on some Android builds, so this always produces something
 * readable. A row saying "null" in a list of the phones somebody is signed in
 * on is the "unfriendly info" complaint again.
 */
export function deviceLabel(deviceName: string | null | undefined, platform: string): string {
  const name = deviceName?.trim();
  if (name) return name;
  return platform === "ios" ? "An iPhone" : "An Android phone";
}

/**
 * The payload a push carries so tapping it lands somewhere.
 *
 * Deliberately the same three fields the `notifications` table already has, so
 * a tapped push and a tapped inbox row route through one function
 * (`notificationTarget`) rather than two that can disagree. The send path fills
 * these from the row it is delivering.
 */
export type PushData = {
  linkPath?: string | null;
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  type?: string | null;
};

/**
 * Read the routing fields off a push payload.
 *
 * The payload arrives as `unknown` from the native side and is written by the
 * server, so nothing about its shape is guaranteed at the point it is read.
 * Every field is checked rather than cast: a malformed push should open the
 * app, not crash it on launch, which is when a tapped notification is handled.
 */
export function readPushData(raw: unknown): PushData {
  if (!raw || typeof raw !== "object") return {};
  const data = raw as Record<string, unknown>;
  const str = (key: string): string | null => {
    const value = data[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  return {
    linkPath: str("linkPath"),
    projectId: str("projectId"),
    entityType: str("entityType"),
    entityId: str("entityId"),
    type: str("type"),
  };
}
