import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { isLive } from "../apps/web/src/features/photos/components/SharePhotoDialog";

/**
 * The photo Share and Tag review, pinned.
 *
 *   "In the project pictures when i choose a picture and want to share it, it
 *    gives me the old lovable back end with a time limit of sharing for 7 days
 *    or another period of time. I think that whole row needs a review to make
 *    sure we are consistent across the site."
 *
 *   "when I click on tags it shows me the old tags set up not matching the
 *    current site theme."
 *
 * Both land on the selection bar. Its Share opened a dialog built around the
 * shape of the `photo_shares` table - an expiry dropdown defaulting to 7 days,
 * a button that minted a fresh token every press, and a list of every token the
 * photo had ever had - while every other share in the product is one switch and
 * a link. Its Tag drew its own `#name` pills off whichever tag names happened
 * to be on the photos on screen, while the thumbnails and the lightbox use a
 * searchable, colour-coded picker reading the workspace tag library.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SHARE = "apps/web/src/features/photos/components/SharePhotoDialog.tsx";
const BAR = "apps/web/src/features/photos/components/PhotoBulkActionBar.tsx";
const PICKER = "apps/web/src/features/photos/components/PhotoTagPopoverBody.tsx";
const UPLOAD = "apps/web/src/features/photos/components/TagPhotoDialog.tsx";

// ── Share: one switch and a link, like everything else ──────────────────────

describe("sharing a photo reads like sharing anything else in the product", () => {
  const CODE = stripComments(read(SHARE));

  it("offers no expiry choice, the thing the client was handed", () => {
    expect(CODE).not.toContain("SHARE_DURATIONS");
    expect(CODE).not.toMatch(/7 days|30 days|24 hours|Never expires/);
    expect(CODE).not.toMatch(/<Select\b/);
  });

  it("mints links that stay live until they are turned off", () => {
    expect(CODE).toMatch(/expiresInHours: 0/);
  });

  it("is a switch and a link, the shape the other four share surfaces use", () => {
    expect(CODE).toMatch(/<Switch\b/);
    expect(CODE).toContain("Anyone with the link");
    expect(CODE).toContain("Link sharing off");
    // Read-only field plus Copy, not a "create another one" button.
    expect(CODE).toMatch(/readOnly/);
    expect(CODE).not.toContain("Create & copy link");
  });

  it("does not show the token history the table happens to keep", () => {
    expect(CODE).not.toContain("Active links");
    expect(CODE).not.toContain("No links yet for this photo");
  });

  it("turning sharing off kills every live link, not just the newest", () => {
    // A photo shared repeatedly through the old dialog carries several working
    // tokens. Revoking one would leave the link the customer already has alive.
    expect(CODE).toMatch(/for \(const r of liveRows\) await revokePhotoShare/);
  });

  it("says so when an old link still carries an expiry", () => {
    // Legacy rows outlive the dialog that made them, and a dated link that
    // looks permanent is how somebody finds out it died by being told.
    expect(CODE).toMatch(/live\?\.expires_at &&/);
  });

  it("matches the wording the document and showcase dialogs already use", () => {
    for (const rel of [
      "apps/web/src/features/projects/components/ProjectDocuments.tsx",
      "apps/web/src/features/showcases/components/ShowcaseShareDialog.tsx",
    ]) {
      const sibling = read(rel);
      expect(sibling).toContain("Anyone with the link");
      expect(sibling).toContain("Link sharing off");
    }
  });
});

describe("sharing a selection uses the same terms as sharing one photo", () => {
  const CODE = stripComments(read(BAR));

  it("drops the expiry dropdown from the batch dialog too", () => {
    expect(CODE).not.toContain("SHARE_DURATIONS");
    expect(CODE).not.toMatch(/Links expire/);
    expect(CODE).not.toMatch(/bulk-share-duration/);
  });

  it("creates never-expiring, downloadable links like reports do", () => {
    expect(CODE).toMatch(/expiresInHours: 0, allowDownload: true/);
  });

  it("keeps the per-photo link list, which a batch genuinely needs", () => {
    // Not plumbing: N photos is N links, and there is nowhere else to read them.
    expect(CODE).toContain("Copy all");
    expect(CODE).toContain("SHARE_LINK_LIMIT");
  });
});

// ── Tags: one picker everywhere ─────────────────────────────────────────────

describe("tagging looks the same wherever it is reached from", () => {
  const BAR_CODE = stripComments(read(BAR));
  const UPLOAD_CODE = stripComments(read(UPLOAD));

  it("the selection bar uses the shared picker, not its own pills", () => {
    expect(BAR_CODE).toContain("<PhotoTagPopoverBody");
    expect(BAR_CODE).not.toMatch(/\{on && <Check className="h-3 w-3" \/>\}#\{t\}/);
  });

  it("the upload flow uses it too", () => {
    expect(UPLOAD_CODE).toContain("<PhotoTagPopoverBody");
    expect(UPLOAD_CODE).not.toMatch(/\{on && <Check className="h-3 w-3" \/>\}#\{t\}/);
  });

  it("no hand-rolled '#name' tag pill survives anywhere in the photos feature", () => {
    // The marker of the old picker: a raw hash and the tag name, rather than
    // TagPill, which is what carries each tag's colour.
    for (const rel of [BAR, UPLOAD, PICKER]) {
      expect(stripComments(read(rel))).not.toMatch(/>\s*\{on && <Check[\s\S]{0,40}#\{/);
    }
  });

  it("the shared picker reads the workspace library, so every surface agrees", () => {
    const picker = stripComments(read(PICKER));
    expect(picker).toMatch(/from\("tags"\)/);
    expect(picker).toContain("<TagPill");
  });

  it("staged callers keep their search while they tick several tags", () => {
    // The popover applies each toggle immediately and resets; a dialog that
    // stages a batch would otherwise clear the search box on every tick.
    const picker = stripComments(read(PICKER));
    expect(picker).toMatch(/if \(!keepSearchOnToggle\) resetSearch\(\)/);
    expect(BAR_CODE).toContain("keepSearchOnToggle");
    expect(UPLOAD_CODE).toContain("keepSearchOnToggle");
  });

  it("nothing writes tags before Apply is pressed", () => {
    // `picked` is the dialog's staging list. If the picker wrote through, the
    // batch would be applied one tick at a time and Cancel would be a lie.
    expect(BAR_CODE).toMatch(/photoTags=\{picked\}/);
    expect(BAR_CODE).toMatch(/onToggle=\{toggle\}/);
  });
});

describe("the tag components that no longer had a caller are gone", () => {
  it("TagPicker.tsx is deleted rather than left as a third variant", () => {
    expect(existsSync(join(ROOT, "apps/web/src/features/photos/components/TagPicker.tsx"))).toBe(
      false,
    );
  });

  it("the Gallery does not import a dialog it never renders", () => {
    const gallery = read("apps/web/src/features/gallery/pages/GalleryPage.tsx");
    expect(gallery).not.toContain("TagPhotoDialog");
  });

  it("no page still threads a tag list into a bar that stopped reading it", () => {
    for (const rel of [
      BAR,
      "apps/web/src/features/gallery/pages/GalleryPage.tsx",
      "apps/web/src/features/projects/pages/ProjectDetailPage.tsx",
    ]) {
      expect(read(rel)).not.toContain("allExistingTags");
    }
  });
});

describe("the share dialog does not show the previous photo's link", () => {
  const CODE = stripComments(read(SHARE));

  it("clears on close, not only on open", () => {
    // Opening on photo B after closing on photo A renders one frame before the
    // effect refetches. Long enough to copy the wrong link.
    expect(CODE).toMatch(
      /if \(!open \|\| !photoId\) \{\s*setLiveRows\(\[\]\);\s*setLoading\(true\);/,
    );
  });
});

// ── The one piece of real logic, run rather than read ───────────────────────

describe("isLive decides what 'this photo is shared' means", () => {
  const HOUR = 3_600_000;
  const row = (over: Partial<{ revoked_at: string | null; expires_at: string | null }> = {}) => ({
    revoked_at: null,
    expires_at: null,
    ...over,
  });

  it("counts a link with no expiry, which is all a new one ever is", () => {
    expect(isLive(row())).toBe(true);
  });

  it("does not count a revoked link, even one whose expiry is still ahead", () => {
    expect(
      isLive(
        row({
          revoked_at: new Date(Date.now() - HOUR).toISOString(),
          expires_at: new Date(Date.now() + 100 * HOUR).toISOString(),
        }),
      ),
    ).toBe(false);
  });

  it("does not count a legacy link whose 7 days ran out", () => {
    expect(isLive(row({ expires_at: new Date(Date.now() - HOUR).toISOString() }))).toBe(false);
  });

  it("still counts a legacy link inside its window, so it can be shown and revoked", () => {
    expect(isLive(row({ expires_at: new Date(Date.now() + HOUR).toISOString() }))).toBe(true);
  });

  it("treats an expiry exactly now as gone, not as a live link", () => {
    expect(isLive(row({ expires_at: new Date(Date.now() - 1).toISOString() }))).toBe(false);
  });

  it("filters a mixed history down to what a visitor could open", () => {
    // The shape a photo shared a few times through the old dialog ends up in.
    const history = [
      row({ expires_at: new Date(Date.now() + 24 * HOUR).toISOString() }),
      row({ revoked_at: new Date().toISOString() }),
      row({ expires_at: new Date(Date.now() - 24 * HOUR).toISOString() }),
      row(),
    ];
    expect(history.filter(isLive)).toHaveLength(2);
  });
});
