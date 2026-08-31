import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expiryLabel,
  exposureSummary,
  liveShares,
  revokeWarning,
  shareState,
  sortedShares,
  type PhotoShareRow,
} from "../apps/mobile/src/api/photo-shares-view";

/*
 * Links handed out for one photograph.
 *
 * A share link is a jobsite photograph sitting on the open internet with no
 * login in front of it. The phone could mint them and never see them again, and
 * every tap of Share minted a FRESH token rather than reusing one, so three
 * taps left three independently live URLs that nothing on the phone could count
 * or withdraw.
 *
 * So the rule under test is "is this link still live", and the direction of its
 * errors matters: calling a dead link live costs a wasted tap, calling a LIVE
 * link dead tells somebody a photograph is closed when it is still public.
 */

const NOW = new Date("2026-08-31T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const share = (over: Partial<PhotoShareRow>): PhotoShareRow => ({
  id: "s1",
  token: "t1",
  expires_at: hoursFromNow(24),
  allow_download: true,
  created_at: "2026-08-31T09:00:00Z",
  revoked_at: null,
  ...over,
});

describe("shareState", () => {
  it("is live before the expiry", () => {
    expect(shareState(share({}), NOW)).toBe("live");
  });

  it("is expired after it", () => {
    expect(shareState(share({ expires_at: hoursFromNow(-1) }), NOW)).toBe("expired");
  });

  it("is live forever when there is no expiry", () => {
    // A permanent link is the case worth noticing, not a missing value to
    // treat as expired.
    expect(shareState(share({ expires_at: null }), NOW)).toBe("live");
  });

  it("is revoked once withdrawn, whatever the expiry says", () => {
    expect(shareState(share({ revoked_at: "2026-08-30T00:00:00Z" }), NOW)).toBe("revoked");
  });

  it("reports revoked rather than expired when a link is both", () => {
    /*
     * Revoking is something a person did and expiry is something that happened.
     * The one somebody acted on is the one worth reporting back to them.
     */
    const both = share({ expires_at: hoursFromNow(-5), revoked_at: "2026-08-30T00:00:00Z" });
    expect(shareState(both, NOW)).toBe("revoked");
  });

  it("treats an unreadable expiry as live, not expired", () => {
    /*
     * The safe direction. Calling a working link "expired" hides the Withdraw
     * button, so somebody stops worrying about a photograph that is still
     * public. Calling a dead one live costs one wasted tap.
     */
    expect(shareState(share({ expires_at: "not a date" }), NOW)).toBe("live");
  });

  it("counts the exact moment of expiry as expired", () => {
    expect(shareState(share({ expires_at: NOW.toISOString() }), NOW)).toBe("expired");
  });
});

describe("liveShares", () => {
  it("keeps only what still opens", () => {
    const rows = [
      share({ id: "a" }),
      share({ id: "b", expires_at: hoursFromNow(-1) }),
      share({ id: "c", revoked_at: "2026-08-30T00:00:00Z" }),
      share({ id: "d", expires_at: null }),
    ];
    expect(liveShares(rows, NOW).map((s) => s.id)).toEqual(["a", "d"]);
  });
});

describe("expiryLabel", () => {
  it("says how long is left", () => {
    expect(expiryLabel(share({ expires_at: hoursFromNow(3) }), NOW)).toBe("Expires in 3 hours");
    expect(expiryLabel(share({ expires_at: hoursFromNow(1) }), NOW)).toBe("Expires in 1 hour");
    expect(expiryLabel(share({ expires_at: hoursFromNow(48) }), NOW)).toBe("Expires in 2 days");
  });

  it("does not say 0 hours for something still live", () => {
    // "Expires in 0 hours" reads as already dead.
    expect(expiryLabel(share({ expires_at: hoursFromNow(0.5) }), NOW)).toBe(
      "Expires within the hour",
    );
  });

  it("is blunt about a permanent link", () => {
    // The wording that makes it land. This is the state somebody should notice.
    expect(expiryLabel(share({ expires_at: null }), NOW)).toBe("Never expires");
  });

  it("names the dead states plainly", () => {
    expect(expiryLabel(share({ expires_at: hoursFromNow(-1) }), NOW)).toBe("Expired");
    expect(expiryLabel(share({ revoked_at: "2026-08-30T00:00:00Z" }), NOW)).toBe("Withdrawn");
  });
});

describe("exposureSummary", () => {
  it("says nothing when nothing is open", () => {
    // A permanent "0 links" on every photograph is noise, and this line exists
    // to be noticed on the photographs where it is not zero.
    expect(exposureSummary([], NOW)).toBeNull();
    expect(exposureSummary([share({ revoked_at: "2026-08-30T00:00:00Z" })], NOW)).toBeNull();
  });

  it("counts only live links", () => {
    const rows = [share({ id: "a" }), share({ id: "b", expires_at: hoursFromNow(-1) })];
    expect(exposureSummary(rows, NOW)).toBe("1 live link");
  });

  it("calls out the permanent ones separately", () => {
    expect(exposureSummary([share({ expires_at: null })], NOW)).toBe("1 live link, no expiry");
    expect(exposureSummary([share({ expires_at: null }), share({ expires_at: null })], NOW)).toBe(
      "2 live links, none expiring",
    );
    expect(exposureSummary([share({}), share({ expires_at: null })], NOW)).toBe(
      "2 live links, 1 with no expiry",
    );
  });
});

describe("sortedShares", () => {
  it("puts live links first, then newest", () => {
    const rows = [
      share({ id: "old", created_at: "2026-08-01T00:00:00Z" }),
      share({ id: "dead", revoked_at: "2026-08-30T00:00:00Z" }),
      share({ id: "new", created_at: "2026-08-31T11:00:00Z" }),
    ];
    expect(sortedShares(rows, NOW).map((s) => s.id)).toEqual(["new", "old", "dead"]);
  });

  it("does not mutate what it was given", () => {
    const rows = [share({ id: "a" }), share({ id: "b" })];
    sortedShares(rows, NOW);
    expect(rows.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("revokeWarning", () => {
  it("is honest that a downloaded copy cannot be recalled", () => {
    // Withdrawing a link closes the door; it does not reach into somebody's
    // downloads folder, and implying otherwise would be the wrong reassurance.
    expect(revokeWarning(share({ allow_download: true }))).toContain("already saved");
    expect(revokeWarning(share({ allow_download: false }))).not.toContain("already saved");
  });
});

describe("the phone and the server agree", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/photos/shares.ts"), "utf8");
  const client = () => readFileSync(join(process.cwd(), "apps/mobile/src/api/sharing.ts"), "utf8");

  it("sends allowDownload, which the schema requires and the phone once omitted", () => {
    /*
     * A live outage, found by reading the schema rather than by any test.
     * `createPhotoShareInputSchema` declares `allowDownload: z.boolean()` with
     * no default and no `.optional()`, and the registry runs `.parse()` on the
     * way in, so every Share tap on the phone was rejected before the service
     * ran. Nothing caught it: the op name was real, both fields sent were real,
     * and the client declares its own types.
     */
    const schema = service().slice(service().indexOf("createPhotoShareInputSchema"));
    expect(schema.slice(0, 300)).toContain("allowDownload: z.boolean()");
    // No default, so it really is required.
    expect(schema.slice(0, 300)).not.toContain("allowDownload: z.boolean().optional()");
    expect(client()).toContain("allowDownload");
  });

  it("reads the row fields the service selects", () => {
    const s = service();
    for (const column of ["expires_at", "allow_download", "revoked_at", "created_at"]) {
      expect(s, column).toContain(column);
    }
    const view = readFileSync(
      join(process.cwd(), "apps/mobile/src/api/photo-shares-view.ts"),
      "utf8",
    );
    for (const column of ["expires_at", "allow_download", "revoked_at", "created_at"]) {
      expect(view, column).toContain(column);
    }
  });

  it("revokes by stamping rather than deleting, so the row stays auditable", () => {
    expect(service()).toContain("revoked_at: new Date().toISOString()");
    expect(client()).toContain("revokePhotoShare");
  });

  it("no longer mints a token straight from the lightbox", () => {
    /*
     * The behaviour change this feature is really about: Share opens the list
     * of what is already public instead of silently adding to it.
     */
    const screen = readFileSync(
      join(process.cwd(), "apps/mobile/app/(app)/project/[id]/index.tsx"),
      "utf8",
    );
    expect(screen).toContain("PhotoSharesSheet");
    expect(screen).not.toContain("createPhotoShareToken");
  });
});
