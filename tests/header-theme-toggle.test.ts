import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The day / night switch, pinned to the header.
 *
 *   "Can we get a day and night toggle somewhere in the header?"
 *
 * Every part of the theme already existed when that came in: the `.dark` token
 * block, the ThemeProvider that writes the class and the localStorage key, the
 * bootstrap script that replays the choice before first paint, the Settings >
 * Appearance picker, and a toggle in the marketing SiteHeader. The one header
 * without a control was AppHeader, which is the header a signed-in user is
 * actually looking at, so night mode was only reachable four clicks deep in
 * Settings.
 *
 * These pin the pieces that a later refactor could quietly drop: the button
 * itself, the shared provider behind it (rather than a second private copy of
 * the state), the mount guard that keeps the server-rendered markup free of a
 * guessed theme, and the storage key that ties the header, the bootstrap
 * script, and the Settings picker to the same choice.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const APP_HEADER = "apps/web/src/components/AppHeader.tsx";
const SITE_HEADER = "apps/web/src/components/SiteHeader.tsx";
const THEME = "apps/web/src/hooks/use-theme.tsx";
const ROOT_ROUTE = "apps/web/src/routes/__root.tsx";
const SETTINGS = "apps/web/src/features/settings/pages/SettingsPage.tsx";

describe("the app header carries a day / night toggle", () => {
  const CODE = read(APP_HEADER);

  it("renders a button that says which way it switches", () => {
    expect(CODE).toContain("Switch to night mode");
    expect(CODE).toContain("Switch to day mode");
  });

  it("shows the sun in night mode and the moon in day mode", () => {
    expect(CODE).toMatch(/from "lucide-react"/);
    expect(CODE).toMatch(/Moon/);
    expect(CODE).toMatch(/Sun/);
    expect(CODE).toMatch(/theme === "dark" \? <Sun[\s\S]*?: <Moon/);
  });

  it("drives the shared provider rather than a second copy of the state", () => {
    expect(CODE).toContain('from "@/hooks/use-theme"');
    expect(CODE).toMatch(/useTheme\(\)/);
    // A private useState here would leave the Settings picker and the header
    // disagreeing about what the current theme is.
    expect(CODE).not.toMatch(/useState<[^>]*"dark"/);
  });

  it("holds the icon back until the client knows the theme", () => {
    // The server has no localStorage, so it would always render the day icon
    // and a night-mode visitor would hydrate onto a mismatch.
    expect(CODE).toMatch(/themeReady/);
    expect(CODE).toMatch(/setThemeReady\(true\)/);
    expect(CODE).toMatch(/\{themeReady &&/);
  });

  it("sits in the header, next to the bell", () => {
    const header = CODE.slice(CODE.indexOf("<header"));
    const toggleAt = header.indexOf("Switch to night mode");
    const bellAt = header.indexOf('aria-label="Notifications"');
    expect(toggleAt).toBeGreaterThan(-1);
    expect(bellAt).toBeGreaterThan(-1);
    expect(toggleAt).toBeLessThan(bellAt);
  });

  it("is not hidden at phone width", () => {
    // "+ New project" is `hidden ... sm:inline-flex` on purpose. The toggle is
    // the whole ask, so it must not pick up the same treatment.
    const button = CODE.slice(
      CODE.indexOf("Switch to night mode") - 400,
      CODE.indexOf("Switch to night mode") + 800,
    );
    expect(button).not.toMatch(/\bhidden\b/);
  });
});

describe("both headers and the Settings picker share one choice", () => {
  it("everything reads and writes the same storage key", () => {
    for (const file of [THEME, ROOT_ROUTE]) {
      expect(read(file)).toContain("sitepix-theme");
    }
  });

  it("the provider paints the class the dark tokens hang off", () => {
    const theme = read(THEME);
    expect(theme).toMatch(/classList\.toggle\("dark"/);
    expect(theme).toMatch(/colorScheme = theme/);
    // The `.dark` block is what `@custom-variant dark` resolves against.
    expect(read("apps/web/src/styles.css")).toMatch(/^\.dark \{/m);
  });

  it("the marketing header and the Settings picker still offer it too", () => {
    expect(read(SITE_HEADER)).toMatch(/useTheme\(\)/);
    expect(read(SETTINGS)).toMatch(/\["light", "dark"\] as const/);
  });
});
