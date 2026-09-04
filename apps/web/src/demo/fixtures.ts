/**
 * Sample data for the public /demo tour.
 *
 * The interactive demo renders faithful mockups of the product's real screens,
 * but nothing here is read from a database: the whole tour is static, typed
 * fixtures in this module, plus the real design system (components/ui, lucide
 * icons, Tailwind tokens) so the screens look like the product. No auth, no
 * Supabase calls, no RLS - a visitor can walk the UI without an account.
 *
 * The images are the app's own bundled marketing assets standing in for site
 * photos; swapping them for real demo photos later only touches this file.
 */
import heroImg from "@/assets/hero-construction.png";
import problemImg from "@/assets/problem-image.png";
import valueImg from "@/assets/value-construction.png";
import collaborationImg from "@/assets/collaboration-image.png";
import howItWorksImg from "@/assets/how-it-works-aerial.png";
import ctaImg from "@/assets/cta-construction.png";

export const DEMO_COMPANY = "Harper & Sons Construction";

export type DemoProjectStatus = "active" | "on_hold" | "completed";

export interface DemoPhoto {
  id: string;
  projectId: string;
  caption: string;
  phase: string;
  /** Display string baked in - the tour is static, so there is no date math. */
  taken: string;
  src: string;
}

export interface DemoProject {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  status: DemoProjectStatus;
  phase: string;
  photoCount: number;
  /** Display string baked in, same as photos. */
  updatedAgo: string;
  startedLabel: string;
  cover: string;
  /** Coordinates for the CSS map, as percentages of the map area. */
  mapTop: number;
  mapLeft: number;
}

export interface DemoReport {
  id: string;
  projectId: string;
  title: string;
  kind: "AI" | "Manual";
  /** Display string baked in. */
  generatedAgo: string;
  summary: string;
  highlights: string[];
  notes: string[];
}

export const demoProjects: DemoProject[] = [
  {
    id: "maple",
    name: "Maple Avenue Apartments",
    street: "24 Maple Ave",
    city: "Denver",
    state: "CO",
    status: "active",
    phase: "Finishes",
    photoCount: 2318,
    updatedAgo: "2h ago",
    startedLabel: "Mar 03, 2026",
    cover: heroImg,
    mapTop: 34,
    mapLeft: 24,
  },
  {
    id: "riverside",
    name: "Riverside Retail Shell",
    street: "88 Riverside Dr",
    city: "Aurora",
    state: "CO",
    status: "active",
    phase: "Structure",
    photoCount: 1047,
    updatedAgo: "Today at 7:41 AM",
    startedLabel: "Apr 11, 2026",
    cover: valueImg,
    mapTop: 62,
    mapLeft: 58,
  },
  {
    id: "aspen",
    name: "Aspen Creek Residence",
    street: "411 Aspen Ct",
    city: "Boulder",
    state: "CO",
    status: "on_hold",
    phase: "Envelope",
    photoCount: 544,
    updatedAgo: "3d ago",
    startedLabel: "Jan 22, 2026",
    cover: problemImg,
    mapTop: 22,
    mapLeft: 66,
  },
  {
    id: "summit",
    name: "Summit View Parking Deck",
    street: "12 Summit Blvd",
    city: "Lakewood",
    state: "CO",
    status: "completed",
    phase: "Closeout",
    photoCount: 2931,
    updatedAgo: "1w ago",
    startedLabel: "Jun 08, 2025",
    cover: collaborationImg,
    mapTop: 74,
    mapLeft: 34,
  },
  {
    id: "brewery",
    name: "Crosstown Brewery Fit-out",
    street: "7 Foundry Ln",
    city: "Denver",
    state: "CO",
    status: "completed",
    phase: "Finishes",
    photoCount: 388,
    updatedAgo: "2w ago",
    startedLabel: "Feb 17, 2026",
    cover: howItWorksImg,
    mapTop: 46,
    mapLeft: 82,
  },
];

export const demoPhotos: DemoPhoto[] = [
  {
    id: "p01",
    projectId: "maple",
    caption: "Foundation pour — north corner",
    phase: "Structure",
    taken: "May 8",
    src: heroImg,
  },
  {
    id: "p02",
    projectId: "maple",
    caption: "Moisture barrier over slab",
    phase: "Structure",
    taken: "May 6",
    src: valueImg,
  },
  {
    id: "p03",
    projectId: "maple",
    caption: "Framing inspection — level 3",
    phase: "Framing",
    taken: "May 4",
    src: collaborationImg,
  },
  {
    id: "p04",
    projectId: "maple",
    caption: "MEP rough-in — unit 4B",
    phase: "MEP",
    taken: "May 3",
    src: problemImg,
  },
  {
    id: "p05",
    projectId: "maple",
    caption: "Drywall progress — corridors",
    phase: "Finishes",
    taken: "Today",
    src: howItWorksImg,
  },
  {
    id: "p06",
    projectId: "maple",
    caption: "Cabinetry mock-up — kitchen",
    phase: "Finishes",
    taken: "May 1",
    src: ctaImg,
  },
  {
    id: "p07",
    projectId: "riverside",
    caption: "Site prep — east lot",
    phase: "Site prep",
    taken: "Today",
    src: heroImg,
  },
  {
    id: "p08",
    projectId: "riverside",
    caption: "Footing pour — retail bays",
    phase: "Structure",
    taken: "Yesterday",
    src: valueImg,
  },
  {
    id: "p09",
    projectId: "aspen",
    caption: "Roof sheathing — main gable",
    phase: "Structure",
    taken: "Apr 29",
    src: problemImg,
  },
  {
    id: "p10",
    projectId: "aspen",
    caption: "Window install — south elevation",
    phase: "Envelope",
    taken: "Apr 27",
    src: howItWorksImg,
  },
  {
    id: "p11",
    projectId: "summit",
    caption: "Deck pour — level 2",
    phase: "Structure",
    taken: "Mar 19",
    src: ctaImg,
  },
  {
    id: "p12",
    projectId: "summit",
    caption: "Waterproofing — plaza level",
    phase: "Finishes",
    taken: "Mar 16",
    src: collaborationImg,
  },
  {
    id: "p13",
    projectId: "brewery",
    caption: "Taproom interior — first fit",
    phase: "Finishes",
    taken: "Mar 2",
    src: valueImg,
  },
  {
    id: "p14",
    projectId: "brewery",
    caption: "Kitchen equipment install",
    phase: "MEP",
    taken: "Feb 26",
    src: heroImg,
  },
];

/** Captures per day for the current week, Monday first. */
export const demoWeekCounts = [32, 27, 41, 36, 48, 29, 44] as const;

export interface DemoActivityItem {
  icon: "camera" | "sparkles" | "tag" | "list" | "video";
  text: string;
  when: string;
}

export const demoActivity: DemoActivityItem[] = [
  {
    icon: "camera",
    text: "Dana Whitfield uploaded 24 photos to Maple Avenue Apartments",
    when: "32m ago",
  },
  {
    icon: "sparkles",
    text: "AI report ready — Weekly progress report for Maple Ave",
    when: "2h ago",
  },
  { icon: "tag", text: "Sam Ortega tagged 8 photos in Framing", when: "3h ago" },
  {
    icon: "list",
    text: "Theo Andersson created checklist “Concrete cure & strip”",
    when: "5h ago",
  },
  {
    icon: "video",
    text: "Priya Nair started a walkthrough at Riverside Retail Shell",
    when: "7h ago",
  },
];

export interface DemoCrewMember {
  initials: string;
  name: string;
  role: string;
}

export const demoCrew: DemoCrewMember[] = [
  { initials: "MR", name: "Marcus Reyes", role: "Owner" },
  { initials: "DW", name: "Dana Whitfield", role: "Superintendent" },
  { initials: "SO", name: "Sam Ortega", role: "Project Manager" },
  { initials: "TA", name: "Theo Andersson", role: "Site Lead" },
  { initials: "PN", name: "Priya Nair", role: "Field Engineer" },
];

export const demoReports: DemoReport[] = [
  {
    id: "r1",
    projectId: "maple",
    title: "Weekly progress report",
    kind: "AI",
    generatedAgo: "Generated 2h ago",
    summary:
      "Crews made strong progress on Level 3 and the common corridors this week. Framing on Level 3 is fully inspected and closed, MEP rough-in for units 4B–4D is approved, and drywall is being hung on the north wing. The only open item is the elevator lobby ceiling coordination, which the MEP foreman flagged on Wednesday.",
    highlights: [
      "Level 3 framing inspection cleared — all 12 units closed",
      "MEP rough-in approved for units 4B, 4C and 4D",
      "Drywall hanging started on the north wing corridors",
      "Cabinetry mock-up installed in unit 4B for client sign-off",
    ],
    notes: [
      "Elevator lobby ceiling coordination: resolve MEP clash before Friday's ceiling rough-in",
      "Window deliveries for the east façade confirmed for Wednesday",
      "Concrete cure samples from the Level 3 slab passed — strip scheduled Monday",
    ],
  },
  {
    id: "r2",
    projectId: "riverside",
    title: "Photos as-built — Phase 2 closeout",
    kind: "AI",
    generatedAgo: "Generated yesterday",
    summary:
      "A photo-first as-built record of Phase 2 closeout: 214 photos organised by area, captioned, and tied to the site map so every shot has a place and a date.",
    highlights: [
      "214 photos organised across 14 areas",
      "Roofing, glazing and storefront work captured at completion",
      "Punch-list items photographed with room references",
    ],
    notes: ["Ready to hand to the architect for the closeout package."],
  },
  {
    id: "r3",
    projectId: "summit",
    title: "Asphalt & striping inspection",
    kind: "Manual",
    generatedAgo: "Saved 3 days ago",
    summary:
      "Field inspection of the finished parking deck surface — asphalt thickness spot-checks, striping layout and signage placement were verified against the drawings.",
    highlights: [
      "Spot-check cores met the 2.5″ spec across all 6 bays",
      "Striping layout matches the permit set within 1⁄2″",
      "Handicap signage installed at both elevator lobbies",
    ],
    notes: ["Follow-up on the north ramp joint sealant (2 linear ft)."],
  },
  {
    id: "r4",
    projectId: "maple",
    title: "Daily log — sidewalk pour",
    kind: "AI",
    generatedAgo: "Generated 5 days ago",
    summary:
      "Sidewalk pour at the Maple Avenue street front: crew of 6, 92 cubic yards, placement finished before the heat advisory hit the site.",
    highlights: [
      "92 CY of concrete placed in a single uninterrupted pour",
      "Cure-and-seal applied same day",
      "Street frontage clear for the city inspection on Friday",
    ],
    notes: ["22 photos captured with time stamps from first truck to finish."],
  },
];

export const demoByProject = (projectId: string): DemoPhoto[] =>
  demoPhotos.filter((p) => p.projectId === projectId);

export const demoProjectById = (projectId: string): DemoProject =>
  demoProjects.find((p) => p.id === projectId) ?? demoProjects[0];
