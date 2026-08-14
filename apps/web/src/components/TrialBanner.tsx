interface Props {
  variant?: "full" | "compact";
}

// Payments removed - trials no longer exist. Component kept as a no-op so
// existing imports continue to compile.
export function TrialBanner(_: Props = {}) {
  return null;
}
