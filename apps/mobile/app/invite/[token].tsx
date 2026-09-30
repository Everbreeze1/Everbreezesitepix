import { useLocalSearchParams } from "expo-router";
import { TeamInviteAccept } from "@/components/InviteAccept";

/**
 * `everlumen.co/invite/<token>`, opened in the app.
 *
 * Outside the signed-in tree on purpose: most people arriving here have no
 * account yet, and this screen is how they make one. See `InviteAccept`.
 */
export default function TeamInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <TeamInviteAccept token={typeof token === "string" ? token : ""} />;
}
