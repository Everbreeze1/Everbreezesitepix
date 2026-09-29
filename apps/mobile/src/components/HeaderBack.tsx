import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";
import { router, useRootNavigationState } from "expo-router";
import { parentHref } from "@/lib/back-fallback";
import { ChevronLeft, X } from "@/ui/icons";
import { IconButton } from "@/ui";

/**
 * The back arrow the navigator header shows when it would otherwise show none.
 *
 * The stack draws its own arrow whenever there is a screen under this one.
 * When there is not (opened from a notification or a link), `_layout.tsx`
 * puts this in `headerLeft` instead, pointed at the page the screen belongs
 * under (`parentHref`). A modal gets the close glyph.
 */
export function HeaderBackButton({
  onPress,
  variant = "back",
}: {
  onPress: () => void;
  variant?: "back" | "close";
}) {
  return (
    <IconButton
      icon={variant === "close" ? X : ChevronLeft}
      accessibilityLabel={variant === "close" ? "Close" : "Back"}
      surface={false}
      onPress={onPress}
    />
  );
}

type NavState = {
  routes: { name: string; params?: object; state?: NavState }[];
};

/** The signed-in stack's state, wherever the root navigator nests it. */
function findAppStack(state: NavState | undefined): NavState | undefined {
  if (!state?.routes) return undefined;
  for (const route of state.routes) {
    if (route.name === "(app)") return route.state;
    const nested = findAppStack(route.state);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Full-screen camera, recorder and annotator: they own Back (a half-drawn
 * markup or an open note editor closes first) and each has its own close.
 */
const OWNS_BACK = new Set([
  "project/[id]/capture",
  "project/[id]/walkthrough-record",
  "photo/[id]/annotate",
]);

/**
 * Android's hardware Back on a screen that is alone in the signed-in stack.
 *
 * With nothing under it, Back would close the app; the header arrow goes to
 * the parent page instead, and so does this, so the button and the key agree.
 */
export function useFirstScreenHardwareBack(): void {
  const rootState = useRootNavigationState() as unknown as NavState | undefined;
  const app = findAppStack(rootState);
  const only = app && app.routes.length === 1 ? app.routes[0] : null;
  const target =
    only && only.name !== "(tabs)" && !OWNS_BACK.has(only.name)
      ? parentHref(only.name, only.params as Record<string, unknown> | undefined)
      : null;

  useEffect(() => {
    if (Platform.OS !== "android" || !target) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      router.replace(target as never);
      return true;
    });
    return () => sub.remove();
  }, [target]);
}
