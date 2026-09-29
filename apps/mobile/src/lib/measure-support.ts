import { Platform } from "react-native";
import * as Device from "expo-device";

/**
 * Measure is for iPhone 15 Pro and later Pro models only (Jon, 2026-09-27).
 * Android never gets it. Newer devices whose marketing name the installed
 * expo-device does not know yet fall back to the model id: iPhone18 and up.
 */
export function deviceSupportsMeasure(
  os: string = Platform.OS,
  modelName: string | null = Device.modelName,
  modelId: string | null = Device.modelId as string | null,
): boolean {
  if (os !== "ios") return false;
  const named = /^iPhone (\d+) Pro\b/.exec(modelName ?? "");
  if (named) return Number(named[1]) >= 15;
  const id = /^iPhone(\d+),/.exec(modelId ?? "");
  return id ? Number(id[1]) >= 18 : false;
}
