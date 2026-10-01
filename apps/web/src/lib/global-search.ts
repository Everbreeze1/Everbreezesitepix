/**
 * The global search palette's matching, as data.
 *
 * Import-free so it can be tested. The palette (components/GlobalSearch.tsx)
 * loads the workspace's projects and reports once when it opens and narrows
 * them here on every keystroke; photos are searched by the Photo Library
 * itself, which already runs that query on the server.
 */

export type SearchProject = {
  id: string;
  name: string;
  location?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
};

export type SearchReport = {
  /** Which editor opens it: the older report builder, or a report page. */
  kind: "legacy" | "page";
  id: string;
  projectId: string;
  projectName: string | null;
  title: string;
  date: string;
};

/** Trimmed, lower-cased, single-spaced. Empty means "nothing typed yet". */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "12 Main St, Springfield, IL", or the free-text location when there is one. */
export function projectAddress(p: SearchProject): string | null {
  if (p.location && p.location.trim()) return p.location;
  const parts = [p.street, p.city, p.state].filter((x): x is string => !!x && x.trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Projects whose name or address contains every word typed, in their
 * original (most recently updated first) order. With nothing typed, the first
 * `limit` are returned so the palette opens on something useful.
 */
export function matchProjects<T extends SearchProject>(raw: string, projects: T[], limit = 6): T[] {
  const words = normalizeQuery(raw).split(" ").filter(Boolean);
  if (words.length === 0) return projects.slice(0, limit);
  return projects
    .filter((p) => {
      const hay = [p.name, projectAddress(p)].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

/**
 * Reports whose title or project name contains every word typed, newest
 * first. Nothing typed means no reports: they are reached by searching, not
 * listed, so the palette does not open on a wall of documents.
 */
export function matchReports(raw: string, reports: SearchReport[], limit = 6): SearchReport[] {
  const words = normalizeQuery(raw).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  return reports
    .filter((r) => {
      const hay = `${r.title} ${r.projectName ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
}

/** Whether a keydown is the palette shortcut: Cmd+K on a Mac, Ctrl+K elsewhere. */
export function isSearchShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}
