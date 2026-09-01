import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Home shows the work, and the brand appears in the product.
 *
 * Two separate complaints with one root: the app was entirely words. Home
 * answered "what needs you" in counts, task titles and a menu, and the first
 * screen anybody saw carried the name as text with no mark on it. A field app
 * whose home screen shows no field reads as a filing cabinet, and an amber icon
 * that opens a blue app with no amber in it reads as somebody else's product.
 *
 * These are structural assertions. Whether the strip LOOKS right is a device
 * question and belongs to the testing session; what is pinned here is that the
 * photographs are fetched and drawn at all, and in an order that was argued for
 * rather than stumbled into.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const home = () => read("apps/mobile/app/(app)/(tabs)/index.tsx");

describe("home shows photographs", () => {
  it("fetches a page of the workspace gallery", () => {
    /*
     * The same query the Gallery tab runs, deliberately: it is already tested,
     * already handles the unsignable-object case, and being the same call means
     * the tab it leads to is warm when somebody gets there.
     */
    const s = home();
    expect(s).toContain("listGalleryPhotoPage(null, STRIP_PHOTOS)");
    expect(s).toContain('queryKey: ["home-recent-photos"]');
  });

  it("draws them with PhotoThumb, not a bare Image", () => {
    /*
     * The reason that component exists. A tile whose signed URL could not be
     * produced draws NOTHING with an `<Image>` - not a box, not a colour - so a
     * strip of missing photos would read as a layout bug instead of as missing
     * files. This workspace has rows pointing at objects that were never
     * uploaded, so it is not a hypothetical.
     */
    const s = home();
    expect(s).toContain("<PhotoThumb");
    expect(s).not.toMatch(/<Image\s+source=\{\{\s*uri/);
  });

  it("refetches on pull-to-refresh with everything else", () => {
    // A strip that never refreshes is worse than none: it shows yesterday's
    // work and looks current.
    expect(home()).toContain("void recentPhotosQuery.refetch();");
    expect(home()).toContain("recentPhotosQuery.isRefetching");
  });

  it("hides itself rather than drawing an empty rail", () => {
    expect(home()).toContain("{stripPhotos.length > 0 ? (");
  });

  it("keeps the urgency order: queue and overdue work come first", () => {
    /*
     * The decision this file argues for, so it is worth pinning. The queue is
     * the only thing on the screen that can be LOST, and an overdue task can
     * lose a day; a photograph taken yesterday is not going anywhere. The strip
     * therefore sits below both and above the menu, because between "here is
     * the work" and "here is a list of screens", the work wins.
     */
    const s = home();
    const queue = s.indexOf("<QueueBanner />");
    const needsYou = s.indexOf("title={`Needs you (${urgent.length})`}");
    const strip = s.indexOf('title="Latest photos"');
    const browse = s.indexOf('<SectionHeader title="Browse" />');

    for (const [name, i] of Object.entries({ queue, needsYou, strip, browse })) {
      expect(i, `${name} is no longer on the home screen`).toBeGreaterThan(-1);
    }
    expect(queue).toBeLessThan(needsYou);
    expect(needsYou).toBeLessThan(strip);
    expect(strip).toBeLessThan(browse);
  });

  it("opens the job rather than the picture", () => {
    // Somebody glancing at home has recognised the site, not the photograph,
    // and the job is where everything else about it is.
    expect(home().replace(/\s+/g, " ")).toContain(
      'router.push({ pathname: "/project/[id]", params: { id: photo.project_id } })',
    );
  });
});

describe("the brand appears inside the product", () => {
  for (const screen of ["login", "signup"]) {
    it(`${screen} carries the mark, not only the name`, () => {
      /*
       * The first screen anybody sees. It had the wordmark as text and no
       * aperture, so the icon people tap on their home screen appeared nowhere
       * in the app they landed in.
       */
      const s = read(`apps/mobile/app/${screen}.tsx`);
      expect(s).toContain('import { BrandMark } from "@/components/BrandMark"');
      expect(s).toContain("<BrandMark size={56}");
    });

    it(`${screen} passes the ground colour, not an outline colour`, () => {
      /*
       * `gapColor` is a BACKDROP. The seams are drawn over the shared blade
       * edges, so the only hairline anyone ever sees is on the rim and around
       * the aperture, where the background shows through. Anything darker than
       * the ground puts a keyline round the mark - which is why the launch
       * screen passes its own dark ground rather than a border colour.
       */
      expect(read(`apps/mobile/app/${screen}.tsx`)).toContain("gapColor={theme.colors.background}");
    });
  }

  it("costs no image asset, because the mark is a vector", () => {
    /*
     * `BrandMark` is a port of the web `logo.svg`, not an exported PNG. That is
     * what keeps it exact at every density and stops it drifting from the web
     * mark. A raster import here would mean somebody has re-drawn it.
     */
    const mark = read("apps/mobile/src/components/BrandMark.tsx");
    expect(mark).toContain('from "react-native-svg"');
    expect(mark).not.toContain("require(");
  });

  it("does not spread the wordmark gold into small text", () => {
    /*
     * The palette's own rule, and an accessibility one rather than a taste one:
     * `#d97c0a` measures about 3.3:1 on the light canvas, which clears AA only
     * at the large bold sizes the wordmark is set at. `tokens.ts` says
     * "Nothing smaller than that may use it."
     *
     * So the brand is made visible with the MARK and with fills, never by
     * repainting the app's blue primary amber. This counts the call sites: it
     * is a tripwire for a well-meant rebrand, not a ban.
     */
    const tokens = read("apps/mobile/src/theme/tokens.ts");
    expect(tokens).toContain("Nothing smaller than that may use it.");

    const files = ["apps/mobile/app/login.tsx", "apps/mobile/app/signup.tsx"];
    const uses = files
      .map((f) => (read(f).match(/colors\.brand/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    // The two wordmarks. If this climbs, read the rule above first.
    expect(uses).toBeLessThanOrEqual(2);
  });
});
