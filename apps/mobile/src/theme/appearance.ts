import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";

/**
 * Light, dark, or whatever the phone is set to.
 *
 * `useTheme` follows `useColorScheme`, and React Native's own
 * `Appearance.setColorScheme` overrides what that hook reports for the whole
 * app, navigator headers and native pickers included. So the override is one
 * call, not a second theme source every screen has to learn about, and "System"
 * is simply handing control back.
 *
 * Kept on the device, not on the profile: somebody who wants a dark phone
 * probably does not want a dark office monitor, and the web keeps its own
 * choice the same way.
 */
export type AppearancePreference = "system" | "light" | "dark";

const KEY = "everlumen-appearance";

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function applyAppearance(preference: AppearancePreference): void {
  try {
    Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
  } catch {
    // Older OS versions without the override keep following the system.
  }
}

export async function loadAppearance(): Promise<AppearancePreference> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    return isAppearancePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export async function saveAppearance(preference: AppearancePreference): Promise<void> {
  applyAppearance(preference);
  try {
    await AsyncStorage.setItem(KEY, preference);
  } catch {
    // The choice still applies for this session; it just will not survive a
    // restart, which is not worth an error on screen.
  }
}

/** Read the stored choice and apply it. Called once at startup. */
export async function restoreAppearance(): Promise<void> {
  const preference = await loadAppearance();
  if (preference !== "system") applyAppearance(preference);
}
