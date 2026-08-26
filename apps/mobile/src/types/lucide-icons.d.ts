/**
 * Types for lucide's per-icon modules.
 *
 * `lucide-react-native` ships one `.d.ts` for the whole package and none for
 * the individual icon files under `dist/esm/icons`, so the deep imports in
 * `src/ui/icons.ts` would otherwise be untyped. Each of those files default
 * exports a `LucideIcon` and nothing else, which is exactly what this says.
 *
 * The deep import exists to keep the other 1600 icons out of the bundle. See
 * the comment at the top of `src/ui/icons.ts` for the measurement.
 */
declare module "lucide-react-native/dist/esm/icons/*" {
  import type { LucideIcon } from "lucide-react-native";

  const icon: LucideIcon;
  export default icon;
}
