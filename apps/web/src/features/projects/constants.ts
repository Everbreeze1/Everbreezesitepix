/** Project status presentation. */

export const STATUS_DOT: Record<string, { dot: string; text: string; label: string }> = {
  active: { dot: "#34D399", text: "#6EE7B7", label: "Active" },
  on_hold: { dot: "#FBBF24", text: "#FDE68A", label: "On hold" },
  completed: { dot: "#60A5FA", text: "#93C5FD", label: "Completed" },
  archived: { dot: "#64748B", text: "#94A3B8", label: "Archived" },
};
