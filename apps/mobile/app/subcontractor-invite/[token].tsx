import { useLocalSearchParams } from "expo-router";
import { SubcontractorInviteAccept } from "@/components/InviteAccept";

/**
 * `everlumen.co/subcontractor-invite/<token>`, opened in the app: an outside
 * firm being let into named jobs. Reachable signed out. See `InviteAccept`.
 */
export default function SubcontractorInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <SubcontractorInviteAccept token={typeof token === "string" ? token : ""} />;
}
