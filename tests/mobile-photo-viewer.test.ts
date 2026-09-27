import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fallbackTagColor,
  isTabletWidth,
  liveShareRows,
  mapsLink,
  normalizeTag,
  readableOn,
  sidePanelWidth,
  stepIndex,
  tagTitle,
  toggleTagName,
  viewerPosition,
} from "../apps/mobile/src/api/photo-viewer-view";

/*
 * The phone's photo viewer is the web lightbox and details panel rebuilt for a
 * phone and a tablet. These are the rules the two surfaces have to agree on,
 * and the wiring that makes it the ONE viewer rather than one of several.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("layout", () => {
  it("puts the panel beside the photo from web's md breakpoint", () => {
    expect(isTabletWidth(767)).toBe(false);
    expect(isTabletWidth(768)).toBe(true);
    expect(sidePanelWidth(800)).toBe(380);
    expect(sidePanelWidth(1024)).toBe(420);
  });

  it("reads the position the way the web top bar does", () => {
    expect(viewerPosition(1, 200)).toBe("2 / 200");
    expect(viewerPosition(0, 0)).toBe("");
  });

  it("pages without wrapping past either end", () => {
    expect(stepIndex(0, -1, 5)).toBe(0);
    expect(stepIndex(4, 1, 5)).toBe(4);
    expect(stepIndex(2, 1, 5)).toBe(3);
  });
});

describe("tags match web", () => {
  it("normalises a new tag name the way web stores it", () => {
    expect(normalizeTag("  North Wall ")).toBe("north-wall");
    expect(normalizeTag("x".repeat(40))).toHaveLength(32);
  });

  it("toggles a tag on and off", () => {
    expect(toggleTagName(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleTagName(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleTagName(null, "a")).toEqual(["a"]);
  });

  it("paints an unknown tag with web's fallback hash", () => {
    // Same palette and hash as apps/web/src/hooks/use-tag-colors.tsx.
    const web = read("apps/web/src/hooks/use-tag-colors.tsx");
    expect(web).toContain("h = (h * 31 + s.charCodeAt(i)) >>> 0");
    expect(fallbackTagColor("roof")).toBe(fallbackTagColor("ROOF "));
    expect(fallbackTagColor("roof")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("picks the more readable of black and white", () => {
    expect(readableOn("#ffffff")).toBe("#0b0b0b");
    expect(readableOn("#000000")).toBe("#ffffff");
    expect(readableOn("not a colour")).toBe("#ffffff");
  });

  it("title-cases a tag for its pill", () => {
    expect(tagTitle("north-wall")).toBe("North Wall");
  });
});

describe("sharing", () => {
  const row = (id: string, extra: Partial<Record<string, string | null>> = {}) => ({
    id,
    token: id,
    expires_at: null,
    allow_download: true,
    created_at: "2026-01-01T00:00:00Z",
    revoked_at: null,
    ...extra,
  });

  it("treats every unrevoked, unexpired link as live", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const live = liveShareRows(
      [
        row("a"),
        row("b", { revoked_at: "2026-02-01T00:00:00Z" }),
        row("c", { expires_at: "2026-03-01T00:00:00Z" }),
        row("d", { expires_at: "2027-01-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" }),
      ],
      now,
    );
    expect(live.map((r) => r.id)).toEqual(["d", "a"]);
  });
});

describe("maps", () => {
  it("prefers the photo's GPS, then the project address", () => {
    expect(mapsLink(1.5, 2.5, "1 Main St")).toContain("query=1.5,2.5");
    expect(mapsLink(null, null, "1 Main St")).toContain("query=1%20Main%20St");
    expect(mapsLink(null, null, "  ")).toBeNull();
  });
});

describe("one viewer", () => {
  it("is what every photo grid opens", () => {
    for (const file of [
      "apps/mobile/app/(app)/(tabs)/gallery.tsx",
      "apps/mobile/app/(app)/project/[id]/index.tsx",
    ]) {
      expect(read(file), file).toContain("<PhotoViewer");
    }
    // The calendar hands the viewer the whole day, not a lone photo.
    expect(read("apps/mobile/src/components/ProjectPhotoCalendar.tsx")).toContain(
      "dayPhotos.data ?? undefined",
    );
  });

  it("keeps the comments route as a wrapper around the same thread", () => {
    expect(read("apps/mobile/app/(app)/photo/[id]/comments.tsx")).toContain("<PhotoCommentsThread");
  });

  it("links a task created from a photo to that photo", () => {
    expect(read("apps/mobile/src/api/tasks.ts")).toContain("photo_ids: input.photoIds ?? []");
    expect(read("apps/mobile/src/components/photo-viewer/PhotoTasksTab.tsx")).toContain(
      "photoIds: [photoId]",
    );
  });
});

/*
 * The owner's note on the first APK: "right now you have words only to
 * describe editing functions" and "the iconography is important". The web
 * viewer is icon-led: a pencil, sparkles, full-screen corners, the share glyph
 * and a cross in the top bar, zoom glyphs over the photo, an icon on every tab
 * and a send arrow in the composer. These hold the phone to the same.
 */
describe("icon-led like the web viewer", () => {
  const dir = "apps/mobile/src/components/photo-viewer";

  it("draws every top-bar action as a labelled icon", () => {
    const s = read(`${dir}/PhotoViewer.tsx`);
    const bar = s.slice(s.indexOf("const topBar = ("), s.indexOf("const pager ="));
    for (const [icon, label] of [
      ["PenLine", "Annotate"],
      ["Sparkles", "Analyse with AI"],
      ["Maximize", "Full screen"],
      ["Share2", "Share photo"],
      ["X", "Close photo"],
    ]) {
      expect(bar).toMatch(new RegExp(`icon=\\{${icon}\\}\\s+label="${label}"`));
    }
  });

  it("offers zoom and a way back out of full screen on a phone too", () => {
    const s = read(`${dir}/PhotoViewer.tsx`);
    expect(s.match(/label="Zoom in"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(s).toContain('label="Exit full screen"');
  });

  it("puts an icon on every tab and on the composer's actions", () => {
    const panel = read(`${dir}/PhotoPanel.tsx`);
    expect(panel.match(/<TabButton\s+icon=\{/g)?.length).toBe(3);
    const thread = read(`${dir}/PhotoCommentsThread.tsx`);
    expect(thread).toContain('accessibilityLabel="Mention a teammate"');
    expect(thread).toContain("<Send ");
    expect(thread).toContain("MENTION TEAMMATE");
  });

  it("shares through icon tiles, not stacked text buttons", () => {
    const sheet = read(`${dir}/PhotoShareSheet.tsx`);
    expect(sheet).not.toContain("<Button");
    expect(sheet.match(/<ShareTile/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
