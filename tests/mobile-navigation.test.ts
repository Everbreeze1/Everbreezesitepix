import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { parentHref } from "../apps/mobile/src/lib/back-fallback";
import { photoLocationTarget } from "../apps/mobile/src/api/photo-viewer-view";

/*
 * Jon, 2026-09-29: "when i navigate to photo library there is no back button
 * to navigate back. some of the pages have back buttons some of them dont.
 * can we make sure that is all navigable." And the photo viewer's location
 * button opened Google Maps over the whole phone with no way back to the
 * photo.
 *
 * Whether a screen has a back control is not visible from its own source (the
 * header comes from `_layout.tsx`), so this reads both.
 */

const ROOT = process.cwd();
const APP = join(ROOT, "apps/mobile/app");
const read = (p: string) => readFileSync(p, "utf8");
const readApp = (p: string) => read(join(APP, p));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Route key as `_layout.tsx` writes it, e.g. `project/[id]/checklists`. */
function routeKey(file: string): string {
  return relative(join(APP, "(app)"), file).split(sep).join("/").slice(0, -4);
}
const stripIndex = (k: string) => (k.endsWith("/index") ? k.slice(0, -6) : k);

describe("every pushed screen has a way back", () => {
  const layout = readApp("(app)/_layout.tsx");

  const headerless = new Set<string>();
  const layoutOptions = new Map<string, string>();
  for (const chunk of layout.split("<Stack.Screen").slice(1)) {
    const element = chunk.slice(0, chunk.indexOf("/>") + 1);
    const name = element.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    layoutOptions.set(name, element);
    if (element.includes("headerShown: false")) headerless.add(name);
  }

  const screens = walk(join(APP, "(app)")).filter((f) => {
    const posix = f.split(sep).join("/");
    return !posix.includes("/(tabs)/") && !posix.endsWith("/_layout.tsx");
  });

  it("finds the screens, so this cannot pass vacuously", () => {
    expect(screens.length).toBeGreaterThan(40);
  });

  it("gives a screen that is first in the stack a back arrow to its parent page", () => {
    // The stack draws its own arrow only when there is a screen underneath.
    expect(layout).toMatch(/screenOptions=\{\(args\) => \(\{\s*\.\.\.fallbackBack\(/);
    expect(layout).toContain("parentHref(route.name");
    expect(layout).toContain("<HeaderBackButton");
    expect(layout).toContain("useFirstScreenHardwareBack();");
  });

  /** A control the screen draws itself, when the navigator header is off. */
  const OWN_BACK = [
    "<ProjectSubPageHeader",
    "<SubPageHeader",
    'accessibilityLabel="Back"',
    'accessibilityLabel="Close camera"',
    'accessibilityLabel="Close"',
    "onCancel={() => goBack(",
  ];

  for (const file of screens) {
    const key = routeKey(file);
    it(`${key} renders a back control or sits under a header that does`, () => {
      const source = read(file);
      const hidden =
        headerless.has(key) ||
        headerless.has(stripIndex(key)) ||
        source.includes("headerShown: false");
      if (!hidden) {
        // The navigator header: its own arrow, or `fallbackBack`'s.
        expect(source).not.toMatch(/headerLeft:\s*\(\)\s*=>\s*null/);
        expect(source).not.toContain("headerBackVisible: false");
        return;
      }
      expect(
        OWN_BACK.some((needle) => source.includes(needle)),
        `${key} turns the navigator header off and draws no back or close of its own`,
      ).toBe(true);
    });
  }

  it("never calls a bare router.back(), which does nothing with no history", () => {
    // Guarded by `router.canGoBack()` with a replace fallback, or via `goBack`.
    for (const file of walk(APP)) {
      for (const line of read(file).split("\n")) {
        if (line.includes("router.back()")) {
          expect(line, routeKey(file)).toContain("router.canGoBack()");
        }
      }
    }
  });

  it("gives the New photos modal a close button", () => {
    const element = layoutOptions.get("capture-start") ?? "";
    expect(element).toContain('presentation: "modal"');
    expect(element).toContain("...MODAL_CLOSE");
    expect(layout).toMatch(
      /MODAL_CLOSE = \{\s*headerLeft: \(\) => <HeaderBackButton variant="close"/,
    );
  });

  it("lets the camera's permission screen be left on iOS", () => {
    const s = readApp("(app)/project/[id]/capture.tsx");
    const denied = s.slice(s.indexOf("if (!permission.granted)"), s.indexOf("const editingShot"));
    expect(denied).toContain('accessibilityLabel="Close camera"');
    expect(denied).toContain("goBack(`/project/${projectId}`)");
  });

  it("gives Android's hardware Back the same parent page as the arrow", () => {
    const s = read(join(ROOT, "apps/mobile/src/components/HeaderBack.tsx"));
    expect(s).toContain('BackHandler.addEventListener("hardwareBackPress"');
    expect(s).toContain("parentHref(only.name");
    // The camera, recorder and annotator close their own panels first.
    for (const name of [
      "project/[id]/capture",
      "project/[id]/walkthrough-record",
      "photo/[id]/annotate",
    ]) {
      expect(s).toContain(`"${name}"`);
    }
  });
});

describe("the parent page Back falls back to", () => {
  it("sends a project's pages to the project", () => {
    expect(parentHref("project/[id]/tasks", { id: "p1" })).toBe("/project/p1");
    expect(parentHref("project/[id]/capture", { id: "p1" })).toBe("/project/p1");
    expect(parentHref("project/[id]/index", { id: "p1" })).toBe("/projects");
  });

  it("sends a photo's pages to its project, else the Photo Library", () => {
    expect(parentHref("photo/[id]/location", { id: "x", projectId: "p2" })).toBe("/project/p2");
    expect(parentHref("photo/[id]/comments", { id: "x" })).toBe("/gallery");
    expect(parentHref("photo/[id]/location", { id: "x", projectId: "" })).toBe("/gallery");
  });

  it("sends settings and admin to where they are listed", () => {
    expect(parentHref("settings/profile")).toBe("/account");
    expect(parentHref("queue")).toBe("/account");
    expect(parentHref("admin/users")).toBe("/admin");
    expect(parentHref("admin/user/[id]", { id: "u" })).toBe("/admin");
    expect(parentHref("report/edit/[reportId]", { reportId: "r" })).toBe("/report/r");
    expect(parentHref("report/[reportId]", { reportId: "r" })).toBe("/reports");
  });

  it("sends everything else Home", () => {
    expect(parentHref("reports")).toBe("/");
    expect(parentHref("map")).toBe("/");
    expect(parentHref("notifications")).toBe("/");
  });
});

describe("the tabs show Back when they were reached from somewhere", () => {
  it("keeps a tab history, so Back returns to the tab you came from", () => {
    expect(readApp("(app)/(tabs)/_layout.tsx")).toContain('backBehavior="history"');
  });

  it("puts a back arrow on the Photo Library, Projects and Account", () => {
    const gallery = readApp("(app)/(tabs)/gallery.tsx");
    expect(gallery).toContain("const tabBack = useTabBack();");
    expect(gallery).toContain("onBack={selecting ? undefined : tabBack}");
    expect(readApp("(app)/(tabs)/projects.tsx")).toContain("onBack={tabBack}");
    const account = readApp("(app)/(tabs)/account.tsx");
    expect(account).toContain("const tabBack = useTabBack();");
    expect(account).toMatch(
      /tabBack \? \(\s*<IconButton\s+icon=\{ChevronLeft\}\s+accessibilityLabel="Back"/,
    );
  });

  it("leaves Home without one: it is where Back ends", () => {
    expect(readApp("(app)/(tabs)/index.tsx")).not.toContain("useTabBack");
  });

  it("draws the arrow in the shared page header only when asked", () => {
    const s = read(join(ROOT, "apps/mobile/src/ui/PageHeader.tsx"));
    expect(s).toMatch(
      /\{onBack \? \(\s*<IconButton\s+icon=\{ChevronLeft\}\s+accessibilityLabel="Back"/,
    );
  });

  it("shows the arrow only when the tab history has somewhere to go", () => {
    const s = read(join(ROOT, "apps/mobile/src/lib/navigation.ts"));
    expect(s).toContain("(state?.history?.length ?? 0) < 2");
    expect(s).toContain("if (router.canGoBack()) router.back();");
    expect(s).toContain("else router.replace(fallback as never);");
  });
});

describe("the photo's location opens inside the app", () => {
  const dir = "apps/mobile/src/components/photo-viewer";

  it("never hands the viewer's location buttons to another app", () => {
    for (const file of ["PhotoPanel.tsx", "PhotoDetailsTab.tsx", "PhotoViewer.tsx"]) {
      const s = read(join(ROOT, dir, file));
      expect(s, file).not.toContain("Linking");
      expect(s, file).not.toContain("mapsLink(");
    }
  });

  it("pushes the in-app location screen, so the viewer only hides", () => {
    const s = read(join(ROOT, dir, "PhotoViewer.tsx"));
    expect(s).toContain('pathname: "/photo/[id]/location"');
    expect(s).toContain("onOpenLocation={openLocation}");
    // Opening the location must not close the viewer, or Back lands on the grid.
    const block = s.slice(s.indexOf("const openLocation ="), s.indexOf("const openProject ="));
    expect(block).not.toContain("onClose()");
  });

  it("registers the location screen with a header, so it has Back", () => {
    const layout = readApp("(app)/_layout.tsx");
    expect(layout).toContain(
      '<Stack.Screen name="photo/[id]/location" options={{ title: "Photo location" }} />',
    );
    const screen = readApp("(app)/photo/[id]/location.tsx");
    expect(screen).not.toContain("headerShown: false");
    expect(screen).toContain("<MapView");
    expect(screen).toContain("useLayout()");
    // Google Maps stays, as the secondary action on the card.
    expect(screen).toContain('label="Open in Google Maps"');
    expect(screen).toContain('variant="outline"');
  });

  it("pins the photo's GPS, else the project's site, else only the address", () => {
    const photo = photoLocationTarget({ latitude: 43.6, longitude: -79.4 }, null, "1 Main St");
    expect(photo.kind).toBe("photo");
    expect(photo.coord).toEqual({ latitude: 43.6, longitude: -79.4 });
    expect(photo.mapsUrl).toContain("query=43.6,-79.4");

    const site = photoLocationTarget(
      { latitude: null, longitude: null },
      { latitude: 1, longitude: 2 },
      "1 Main St",
    );
    expect(site.kind).toBe("project");
    expect(site.coord).toEqual({ latitude: 1, longitude: 2 });
    expect(site.mapsUrl).toContain("query=1%20Main%20St");

    const address = photoLocationTarget(null, { latitude: null, longitude: null }, "1 Main St");
    expect(address).toEqual({
      kind: "address",
      coord: null,
      mapsUrl: expect.stringContaining("query=1%20Main%20St"),
    });

    expect(photoLocationTarget(null, null, "  ")).toEqual({
      kind: "none",
      coord: null,
      mapsUrl: null,
    });
  });
});

describe("no Before / After chooser in the photo details", () => {
  const details = read(join(ROOT, "apps/mobile/src/components/photo-viewer/PhotoDetailsTab.tsx"));
  const viewer = read(join(ROOT, "apps/mobile/src/components/photo-viewer/PhotoViewer.tsx"));

  it("drops the section and its wiring", () => {
    expect(details).not.toContain('label="Before / after"');
    expect(details).not.toContain("PHASES");
    expect(details).not.toContain("onSetPhase");
    expect(viewer).not.toContain("onSetPhase");
    expect(viewer).not.toContain("phasePatch");
  });

  it("keeps the capture information: who, when and where", () => {
    expect(details).toContain('label="Capture"');
    expect(details).toContain('label="Taken by"');
    expect(details).toContain('label="Taken"');
    expect(details).toContain('label="Location"');
    expect(details).toContain("formatCoords(");
  });

  it("still hands the phase on to Annotate, so a marked photo keeps it", () => {
    expect(viewer).toContain('phase: photo.phase ?? "untagged"');
  });
});
