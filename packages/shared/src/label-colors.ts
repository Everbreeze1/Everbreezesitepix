// Deterministic palette for label/tag chips so the same label
// always renders in the same color across the app.
const PALETTE: { bg: string; text: string; border: string }[] = [
  { bg: "bg-blue-100 dark:bg-blue-500/15", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200 dark:border-blue-500/30" },
  { bg: "bg-emerald-100 dark:bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-500/30" },
  { bg: "bg-amber-100 dark:bg-amber-500/15", text: "text-amber-800 dark:text-amber-300", border: "border-amber-200 dark:border-amber-500/30" },
  { bg: "bg-rose-100 dark:bg-rose-500/15", text: "text-rose-700 dark:text-rose-300", border: "border-rose-200 dark:border-rose-500/30" },
  { bg: "bg-violet-100 dark:bg-violet-500/15", text: "text-violet-700 dark:text-violet-300", border: "border-violet-200 dark:border-violet-500/30" },
  { bg: "bg-cyan-100 dark:bg-cyan-500/15", text: "text-cyan-700 dark:text-cyan-300", border: "border-cyan-200 dark:border-cyan-500/30" },
  { bg: "bg-fuchsia-100 dark:bg-fuchsia-500/15", text: "text-fuchsia-700 dark:text-fuchsia-300", border: "border-fuchsia-200 dark:border-fuchsia-500/30" },
  { bg: "bg-lime-100 dark:bg-lime-500/15", text: "text-lime-800 dark:text-lime-300", border: "border-lime-200 dark:border-lime-500/30" },
  { bg: "bg-orange-100 dark:bg-orange-500/15", text: "text-orange-800 dark:text-orange-300", border: "border-orange-200 dark:border-orange-500/30" },
  { bg: "bg-teal-100 dark:bg-teal-500/15", text: "text-teal-700 dark:text-teal-300", border: "border-teal-200 dark:border-teal-500/30" },
];

export function labelColor(label: string) {
  let hash = 0;
  const s = label.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function labelChipClass(label: string) {
  const c = labelColor(label);
  return `${c.bg} ${c.text} ${c.border}`;
}
