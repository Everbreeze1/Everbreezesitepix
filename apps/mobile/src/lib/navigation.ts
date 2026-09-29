import { useIsFocused, useNavigation, router } from "expo-router";

/**
 * Back, or the parent page when there is no history to pop.
 *
 * `router.back()` on its own does nothing when a screen was the first one
 * opened (a notification, a share link), which reads as a broken button.
 */
export function goBack(fallback: string = "/"): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}

/**
 * Back for a tab screen: the tab it was reached from, or nothing.
 *
 * The tabs keep a history (`backBehavior="history"` in the tabs layout), so a
 * tab opened from Home, from another tab or from the app menu has somewhere to
 * return to, and Android's Back already goes there. This gives that same step
 * a visible button in the page header. Home, or a tab with nothing before it,
 * gets `undefined` and shows only the tab bar (or the menu button on a tablet).
 */
export function useTabBack(): (() => void) | undefined {
  // Re-read on every visit: the history changes only while another tab shows.
  useIsFocused();
  const navigation = useNavigation();
  const state = navigation.getState() as { history?: unknown[] } | undefined;
  if ((state?.history?.length ?? 0) < 2) return undefined;
  return () => navigation.goBack();
}
