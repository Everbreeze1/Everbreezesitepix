import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  isSearchShortcut,
  matchProjects,
  matchReports,
  normalizeQuery,
  projectAddress,
  type SearchReport,
} from "../apps/web/src/lib/global-search";

/**
 * Three fixes from Jon's walk through the live site.
 *
 *   "We shouldn't have a search box in multiple places on the same page;
 *    place it where it matters such as the projects page."
 *
 *   Clicking the CREW "+" on the projects list flashed the crew window, then
 *   "the page goes crazy" and lands somewhere else.
 *
 *   Reports live at the project level; the sidebar's Reports row is redundant.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const APP_HEADER = "apps/web/src/components/AppHeader.tsx";
const APP_LAYOUT = "apps/web/src/routes/_app.tsx";
const GLOBAL_SEARCH = "apps/web/src/components/GlobalSearch.tsx";
const DASHBOARD = "apps/web/src/features/projects/pages/DashboardPage.tsx";
const PROJECTS = "apps/web/src/features/projects/pages/ProjectsPage.tsx";
const GALLERY = "apps/web/src/features/gallery/pages/GalleryPage.tsx";
const GALLERY_ROUTE = "apps/web/src/routes/_app.gallery.tsx";
const SIDEBAR = "apps/web/src/components/AppSidebar.tsx";
const MOBILE_TABS = "apps/web/src/components/MobileTabBar.tsx";
const REPORTS_ROUTE = "apps/web/src/routes/_app.reports.tsx";

/** How many search inputs a source file draws (inputs and search forms). */
const searchInputs = (src: string) =>
  (
    stripComments(src).match(/<(input|Input|CommandInput)\b[^>]*placeholder=[\s\S]{0,40}Search/g) ??
    []
  ).length;

describe("one search per page", () => {
  it("the shared header draws no search box at any width", () => {
    const src = stripComments(read(APP_HEADER));
    expect(src).not.toMatch(/role="search"/);
    expect(src).not.toMatch(/<input\b/);
    expect(src).not.toMatch(/\bSearch\b/);
    // Its own Cmd+K handler went with the box; the palette owns the shortcut.
    expect(src).not.toMatch(/metaKey/);
  });

  it("the header keeps the sidebar toggle at phone and from md up", () => {
    const src = read(APP_HEADER);
    expect(src.match(/<SidebarTrigger\b/g)?.length).toBe(2);
    expect(src).toMatch(/<SidebarTrigger className="hidden md:inline-flex" \/>/);
    // The control cluster still pushes right on its own once the box is gone.
    expect(src).toMatch(/className="ml-auto flex items-center/);
  });

  it("Cmd/Ctrl+K opens the global palette from anywhere in the app shell", () => {
    const layout = read(APP_LAYOUT);
    expect(layout).toMatch(/<GlobalSearchProvider>/);
    const palette = read(GLOBAL_SEARCH);
    expect(palette).toMatch(/window\.addEventListener\("keydown"/);
    expect(palette).toMatch(/isSearchShortcut\(e\)/);
  });

  it("the Overview has no search box at all (Jon, 2026-10-01)", () => {
    const src = stripComments(read(DASHBOARD));
    expect(src).not.toMatch(/useGlobalSearch\(\)/);
    expect(src).not.toMatch(/openSearch/);
    expect(src).not.toMatch(/Search projects, photos, reports/);
    expect(searchInputs(read(DASHBOARD))).toBe(0);
  });

  it("the palette finds projects and reports and hands photos to the Photo Library", () => {
    const src = read(GLOBAL_SEARCH);
    expect(src).toMatch(/from\("projects"\)/);
    expect(src).toMatch(/from\("project_reports"\)/);
    expect(src).toMatch(/listReportPages\(/);
    expect(src).toMatch(/to: "\/gallery", search: \{ q: term \}/);
    expect(src).toMatch(/to: "\/projects", search: \{ q: term \}/);
  });

  it("the Photo Library follows ?q= into its own search box", () => {
    expect(read(GALLERY_ROUTE)).toMatch(/q: typeof s\.q === "string"/);
    const gallery = read(GALLERY);
    expect(gallery).toMatch(/useState<string>\(search\.q \?\? ""\)/);
    expect(gallery).toMatch(/setTextSearch\(search\.q\)/);
  });

  it("Projects and the Photo Library each draw exactly one search box", () => {
    // The list filter, which doubles as the groups filter on that tab.
    expect(read(PROJECTS).match(/Search projects by name or address/g)?.length).toBe(1);
    // The gallery's other "Search" input is the tag picker inside a popover.
    const gallery = stripComments(read(GALLERY));
    expect(gallery.match(/placeholder="Search photos"/g)?.length).toBe(1);
  });

  it("the projects search placeholder is not mojibake", () => {
    expect(read(PROJECTS)).not.toMatch(/Ã¢â‚¬/);
  });
});

describe("global search matching", () => {
  const projects = [
    { id: "a", name: "Fisher Circle Roof", street: "12 Fisher Cir", city: "Austin", state: "TX" },
    { id: "b", name: "Kitchen remodel", location: "44 Oak Ave, Dallas" },
    { id: "c", name: "Deck", street: null, city: null, state: null },
  ];

  it("normalizes what was typed", () => {
    expect(normalizeQuery("  Fisher   ROOF ")).toBe("fisher roof");
  });

  it("matches every word against name and address", () => {
    expect(matchProjects("fisher austin", projects).map((p) => p.id)).toEqual(["a"]);
    expect(matchProjects("oak", projects).map((p) => p.id)).toEqual(["b"]);
    expect(matchProjects("fisher dallas", projects)).toEqual([]);
  });

  it("opens on the most recent projects when nothing is typed", () => {
    expect(matchProjects("", projects, 2).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("prefers the free-text location and falls back to street, city, state", () => {
    expect(projectAddress(projects[1])).toBe("44 Oak Ave, Dallas");
    expect(projectAddress(projects[0])).toBe("12 Fisher Cir, Austin, TX");
    expect(projectAddress(projects[2])).toBeNull();
  });

  it("finds reports by title or project, newest first, and lists none unprompted", () => {
    const reports: SearchReport[] = [
      {
        kind: "legacy",
        id: "r1",
        projectId: "a",
        projectName: "Fisher Circle Roof",
        title: "Final inspection",
        date: "2026-01-01",
      },
      {
        kind: "page",
        id: "r2",
        projectId: "b",
        projectName: "Kitchen remodel",
        title: "Inspection notes",
        date: "2026-03-01",
      },
    ];
    expect(matchReports("", reports)).toEqual([]);
    expect(matchReports("inspection", reports).map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(matchReports("fisher", reports).map((r) => r.id)).toEqual(["r1"]);
  });

  it("answers Cmd+K and Ctrl+K and nothing else", () => {
    expect(isSearchShortcut({ key: "k", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSearchShortcut({ key: "K", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isSearchShortcut({ key: "k", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isSearchShortcut({ key: "k", metaKey: true, ctrlKey: false, shiftKey: true })).toBe(
      false,
    );
    expect(isSearchShortcut({ key: "j", metaKey: true, ctrlKey: false })).toBe(false);
  });
});

describe("the CREW + on the projects list opens the picker and stays put", () => {
  const src = read(PROJECTS);
  const code = stripComments(src);
  const row = code.slice(
    code.indexOf("function ProjectTableRow"),
    code.indexOf("function ProjectsList"),
  );
  const crewCell = code.slice(
    code.indexOf("function CrewCell"),
    code.indexOf("function RowActions"),
  );
  const rowActions = code.slice(
    code.indexOf("function RowActions"),
    code.indexOf("function ProjectTableRow"),
  );

  it("the row's link no longer wraps the crew and actions controls", () => {
    // A button inside <a href> whose handler stops propagation also stops the
    // router's preventDefault, so the browser followed the href natively.
    const link = row.slice(row.indexOf("<Link"), row.indexOf("</Link>"));
    expect(link).not.toMatch(/<CrewCell/);
    expect(link).not.toMatch(/<RowActions/);
    expect(row).toMatch(/after:absolute after:inset-0/);
    expect(row.indexOf("<CrewCell")).toBeGreaterThan(row.indexOf("</Link>"));
  });

  it("the + prevents the default as well as stopping the click", () => {
    expect(crewCell).toMatch(/e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*onAssign\(\);/);
    expect(crewCell).toMatch(/Assign crew/);
    expect(crewCell).toMatch(/relative z-10/);
  });

  it("the + is there for a crewed job too, not only an empty one", () => {
    expect(crewCell).toMatch(/\{canAssign && \(/);
    expect(crewCell).not.toMatch(/crew\.length === 0 && canAssign \?/);
  });

  it("the row menu is not a second way to assign", () => {
    expect(rowActions).not.toMatch(/Assign teammates/);
    expect(rowActions).not.toMatch(/Change crew/);
    expect(rowActions).not.toMatch(/onAssign/);
    expect(rowActions).toMatch(/"Unstar project" : "Star project"/);
    expect(rowActions).toMatch(/"Restore project" : "Archive project"/);
  });

  it("the project page's Assign also keeps its click from navigating", () => {
    const crew = read("apps/web/src/features/projects/components/ProjectCrew.tsx");
    const presses = crew.match(/e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*onAssign\(\);/g);
    expect(presses?.length).toBe(2);
  });
});

describe("Reports is not a sidebar destination", () => {
  it("no nav links to /reports", () => {
    expect(stripComments(read(SIDEBAR))).not.toMatch(/"\/reports"/);
    expect(read(MOBILE_TABS)).not.toMatch(/"\/reports"/);
  });

  it("/reports redirects to /projects so old links do not 404", () => {
    const src = read(REPORTS_ROUTE);
    expect(src).toMatch(/throw redirect\(\{ to: "\/projects", replace: true \}\)/);
    expect(src).not.toMatch(/component:/);
  });

  it("per-project reports keep their routes", () => {
    expect(
      existsSync(join(ROOT, "apps/web/src/routes/_app.projects.$projectId_.reports.$reportId.tsx")),
    ).toBe(true);
    expect(existsSync(join(ROOT, "apps/web/src/routes/share.reports.$token.tsx"))).toBe(true);
  });
});
