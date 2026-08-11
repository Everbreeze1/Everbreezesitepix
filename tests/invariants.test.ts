import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * Regression guards for defect FAMILIES, not individual lines.
 *
 * Every family below was found repeated across many files, because each one is
 * a project-wide invariant with no single enforcement point — the codebase has
 * no view enforcing the soft delete, no shared "next position" helper, and no
 * wrapper around the Supabase client. Until those enforcement points exist,
 * these tests are the enforcement point: they fail when the pattern comes back.
 *
 * They assert on source text deliberately. The alternative is a full React +
 * Supabase integration harness, which this repo has no infrastructure for.
 */

const ROOT = resolve(__dirname, "..");
const WEB = join(ROOT, "apps/web/src");

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL_WEB_FILES = walk(WEB);

describe("family: soft-delete leakage (photos.deleted_at)", () => {
  // `photos.deleted_at` has no view and no RLS predicate enforcing it, so every
  // read must exclude the trash by hand. These are the picker/stat surfaces
  // that forgot to — a deleted photo reaching one of them ends up embedded in
  // a customer-facing shared report.
  const MUST_FILTER = [
    "apps/web/src/features/projects/pages/ReportBuilderPage.tsx",
    "apps/web/src/features/projects/pages/ProjectPageEditorPage.tsx",
    "apps/web/src/features/projects/components/ProjectChecklists.tsx",
    "apps/web/src/features/projects/components/ProjectSiteLogs.tsx",
    "apps/web/src/features/projects/pages/DashboardPage.tsx",
    "apps/web/src/features/projects/components/SelectPhotosForPageDialog.tsx",
  ];

  it.each(MUST_FILTER)("%s excludes trashed photos", (rel) => {
    expect(read(rel)).toContain('.is("deleted_at", null)');
  });

  it('every `.from("photos")` select in those files has the filter within 12 lines', () => {
    const offenders: string[] = [];
    for (const rel of MUST_FILTER) {
      const lines = read(rel).split("\n");
      lines.forEach((line, i) => {
        if (!line.includes('.from("photos")')) return;
        const window = lines.slice(i, i + 12).join("\n");
        if (!/\.select\(/.test(window)) return;
        // Inserts chain `.select()` to return the new row — not a read.
        if (/\.(insert|update|upsert|delete)\(/.test(window)) return;
        // Lookups of already-linked rows by explicit id are exempt: hiding a
        // trashed photo there would blank out evidence already attached to a
        // checklist or report, which is a different decision from keeping the
        // trash out of a *picker*.
        if (/\.in\(\s*"id"/.test(window)) return;
        if (!window.includes("deleted_at")) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("family: a row delete must be confirmed before its blob is destroyed", () => {
  // `.delete()` with no trailing `.select()` returns 204 with an empty body, so
  // `error === null` does NOT prove a row was affected — an RLS policy that
  // filters every row away is indistinguishable from success. Destroying the
  // storage object on that signal is unrecoverable.
  const CASES = [
    {
      rel: "apps/web/src/features/projects/components/ProjectDocuments.tsx",
      bucket: "site-documents",
    },
    {
      rel: "apps/web/src/features/projects/pages/ProjectDetailPage.tsx",
      bucket: "site-photos",
    },
  ];

  it.each(CASES)("$rel proves rows were deleted before removing from $bucket", ({ rel }) => {
    const src = read(rel);
    // The delete that precedes a storage removal must ask for the affected rows.
    expect(src).toMatch(/\.delete\(\)[\s\S]{0,400}?\.select\(/);
  });
});

describe("family: uploads must not orphan their blob", () => {
  // A failed insert after a successful upload leaves a file no row references.
  // It is unreachable forever: storage usage sums photos.size_bytes so it is
  // not even counted, and every delete path keys off photos.storage_path.
  const CASES = [
    "apps/web/src/features/gallery/pages/GalleryPage.tsx",
    "apps/web/src/features/projects/pages/ProjectDetailPage.tsx",
    "apps/web/src/features/projects/components/ProjectWorkflows.tsx",
    "apps/web/src/features/projects/components/ProjectChecklists.tsx",
    "apps/web/src/features/projects/components/ProjectDocuments.tsx",
  ];

  it.each(CASES)("%s reclaims the upload when the insert fails", (rel) => {
    expect(read(rel)).toMatch(/storage[\s\S]{0,80}\.remove\(\[/);
  });
});

describe("family: new DB positions come from max+1, never .length", () => {
  // The delete paths do not renumber survivors, so positions have permanent
  // gaps and `list.length` hands a new row a number a sibling already holds.
  // Colliding rows then sort arbitrarily between page loads.
  const CASES = [
    "apps/web/src/features/settings/pages/ChecklistTemplatesPage.tsx",
    "apps/web/src/features/settings/pages/WorkflowTemplatesPage.tsx",
    "apps/web/src/features/settings/components/LabelSetsManager.tsx",
    "apps/web/src/features/projects/pages/ReportBuilderPage.tsx",
    "apps/web/src/features/settings/pages/TemplatesPage.tsx",
  ];

  it.each(CASES)("%s derives an insert position with reduce(max)", (rel) => {
    expect(read(rel)).toMatch(/reduce\(\s*\((?:max|[a-z]+),\s*[a-z]+\)\s*=>\s*Math\.max\(/);
  });

  it.each(CASES)("%s does not assign `position: <something>.length`", (rel) => {
    expect(read(rel)).not.toMatch(/position:\s*[A-Za-z_.()?\s]*\.length\b/);
  });
});

describe("family: z-index", () => {
  it("no dragged row uses a z-index that beats AppHeader (z-20)", () => {
    // AppHeader is `sticky top-0 z-20` and nothing between the page root and
    // content creates a stacking context, so any positioned descendant at >=20
    // paints over the app chrome.
    const offenders: string[] = [];
    for (const file of ALL_WEB_FILES) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (!/isDragging/.test(line)) return;
        const m = line.match(/z-\[?(\d+)\]?/);
        if (m && Number(m[1]) >= 20) {
          offenders.push(`${file.replace(ROOT, "")}:${i + 1} -> z-${m[1]}`);
        }
        if (/zIndex:\s*isDragging\s*\?\s*(\d+)/.test(line)) {
          const n = Number(RegExp.$1);
          if (n >= 20) offenders.push(`${file.replace(ROOT, "")}:${i + 1} -> zIndex ${n}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("a z-index on a dragged row is accompanied by positioning (or it is inert)", () => {
    // z-index does nothing on a static box that is not a flex/grid item.
    const offenders: string[] = [];
    for (const file of ALL_WEB_FILES) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!/isDragging/.test(line)) return;
        if (!/\bz-\[?\d/.test(line)) return;
        // The positioning class usually lives in the element's base className,
        // a few lines above the isDragging branch inside the same cn() call —
        // so look at the surrounding block, not the single line.
        const block = lines.slice(Math.max(0, i - 8), i + 2).join("\n");
        if (!/\b(relative|absolute|fixed|sticky)\b/.test(block)) {
          offenders.push(`${file.replace(ROOT, "")}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("family: responsive py-* clobbering a page's bottom clearance", () => {
  // A variant utility outranks an unvariated one, so `pb-32 ... md:py-10`
  // silently collapses desktop bottom padding to 40px — less than the 84px the
  // fixed camera button occupies, so the last row of the page sits under it.
  it("no className sets both an unvariated pb-* and a responsive py-*", () => {
    const offenders: string[] = [];
    for (const file of ALL_WEB_FILES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/className=\{?"([^"]{0,300})"/g)) {
        const cls = m[1];
        if (/(?:^|\s)pb-\d/.test(cls) && /(?:^|\s)(?:sm|md|lg|xl):py-\d/.test(cls)) {
          offenders.push(`${file.replace(ROOT, "")} -> "${cls}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("family: hand-rolled debounce must merge, not replace", () => {
  // A timer closing over a single patch object throws away the previous patch
  // when re-armed, so cross-field edits inside the debounce window are lost
  // while local state still shows them.
  const rel = "apps/web/src/features/projects/pages/ReportBuilderPage.tsx";

  it("accumulates pending report and section patches across calls", () => {
    const src = read(rel);
    expect(src).toContain("reportPending");
    expect(src).toContain("sectionPending");
    expect(src).toMatch(/reportPending\.current\s*=\s*\{\s*\.\.\.reportPending\.current,/);
  });

  it("flushes anything still pending on unmount", () => {
    expect(read(rel)).toMatch(/return\s*\(\)\s*=>\s*\{[\s\S]{0,900}reportPending/);
  });
});

describe("family: signed URLs are batched", () => {
  // `createSignedUrls` (plural) signs a whole array in one request. The
  // singular call inside a row loop was up to 300 sequential round trips.
  const CASES = [
    "apps/web/src/features/projects/components/SelectPhotosForPageDialog.tsx",
    "apps/web/src/features/projects/pages/ProjectPageEditorPage.tsx",
    "apps/web/src/features/projects/components/ProjectSiteLogs.tsx",
    "apps/web/src/features/projects/pages/ReportBuilderPage.tsx",
  ];

  it.each(CASES)("%s uses createSignedUrls and not the per-row singular", (rel) => {
    const src = read(rel);
    expect(src).toContain("createSignedUrls(");
    expect(src).not.toMatch(/\bcreateSignedUrl\(/);
  });
});

describe("public share pages must not inject unsanitised user HTML", () => {
  /*
   * ShowcaseView.tsx states the rule in a comment: "this page is served to
   * anonymous visitors, so dangerouslySetInnerHTML is deliberately avoided."
   * These routes follow it by rendering no raw HTML at all.
   */
  const NO_RAW_HTML = [
    "apps/web/src/routes/share.reports.$token.tsx",
    "apps/web/src/routes/share.showcases.$token.tsx",
    "apps/web/src/routes/share.photos.$token.tsx",
  ];

  it.each(NO_RAW_HTML)("%s does not use dangerouslySetInnerHTML", (rel) => {
    expect(read(rel)).not.toContain("dangerouslySetInnerHTML");
  });

  /*
   * share.pages is the exception: a shared document IS rich text, so it has to
   * render markup. It is safe only because the server sanitises before the
   * HTML ever leaves the API — `content_html` is stored exactly as the author
   * PUT it (write-side validation is a 2MB length cap and nothing else). If
   * this assertion ever fails, the public route is injecting author-controlled
   * HTML into an anonymous visitor's browser again.
   */
  it("getPublicProjectPageService sanitises every HTML field it returns", () => {
    const svc = read("apps/api/src/domains/projects/pages.ts");
    expect(svc).toContain("sanitizePageHtml");
    for (const field of ["contentHtml", "headerHtml", "footerHtml"]) {
      expect(svc).toMatch(new RegExp(`${field}:\\s*sanitizePageHtml\\(`));
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Families found by the production audit. Each one was a live customer-facing
 * defect, and each is a PATTERN rather than a single line — which is why they
 * belong here and not in a unit test.
 * ---------------------------------------------------------------------------
 */

describe("family: `.in()` over an unbounded id list", () => {
  /*
   * PostgREST echoes the request filter back in the Content-Location RESPONSE
   * header, ~37 bytes per uuid. Past ~398 ids that overflows Node's 16 KB
   * header limit; past ~672 the gateway rejects the URI outright.
   *
   * This produced four separate customer-visible bugs at once — a public report
   * PDF that rendered with ZERO photos and still returned 200, trash "Select
   * all" 500ing, the cron purge silently deleting nothing, and browser bulk
   * actions failing with a raw 400. The fix is to chunk; these files must keep
   * doing so.
   */
  const MUST_CHUNK_API = [
    "apps/api/src/domains/reports/public-pdf.ts",
    "apps/api/src/domains/reports/public-get.ts",
    "apps/api/src/domains/trash/service.ts",
    "apps/api/src/domains/hooks/purge-trash.ts",
  ];

  it.each(MUST_CHUNK_API)("%s routes its `.in()` calls through chunked-in", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/from "\.\.\/\.\.\/lib\/chunked-in"/);
    expect(src).toMatch(/selectIn|mutateIn|chunk\(/);
  });

  it("PhotoBulkActionBar batches every bulk write", () => {
    const src = read("apps/web/src/features/photos/components/PhotoBulkActionBar.tsx");
    expect(src).toContain("mutateByIds");
    // Any surviving raw `.in("id", selectedIds)` is the unbounded bug returning.
    expect(src).not.toMatch(/\.in\("id",\s*selectedIds\)/);
  });

  it("the chunk size stays under the header/URI ceiling", async () => {
    const { IN_CHUNK_SIZE, chunk } = await import("../apps/api/src/lib/chunked-in");
    // ~37 bytes per uuid in the echoed filter; 16 KB is the hard limit.
    expect(IN_CHUNK_SIZE * 37).toBeLessThan(16_000);
    const ids = Array.from({ length: 1_000 }, (_, i) => String(i));
    const batches = chunk(ids);
    expect(batches.every((b) => b.length <= IN_CHUNK_SIZE)).toBe(true);
    expect(batches.flat()).toHaveLength(1_000);
    // No empty trailing batch, and an empty input yields no requests at all.
    expect(chunk([])).toEqual([]);
  });
});

describe("family: public share paths must honour the soft delete", () => {
  /*
   * Trashing a project left every share link serving it in full — photos,
   * reports, documents, walkthrough audio and transcripts. Trash is a 60-day
   * window and nothing schedules the purge hook, so in practice it never
   * stopped. Each of these services resolves an object for an ANONYMOUS caller
   * and must check `deleted_at` before returning it.
   */
  const PUBLIC_GETTERS = [
    "apps/api/src/domains/photos/shares.ts",
    "apps/api/src/domains/reports/public-get.ts",
    "apps/api/src/domains/projects/pages.ts",
    "apps/api/src/domains/walkthroughs/service.ts",
  ];

  it.each(PUBLIC_GETTERS)("%s checks deleted_at on the public path", (rel) => {
    expect(read(rel)).toContain("deleted_at");
  });
});

describe("family: Gemini vision calls must inline the image", () => {
  /*
   * Gemini's OpenAI-compatibility endpoint does not fetch remote images; it
   * accepts inline base64 only. Passing a signed storage URL returned
   * INVALID_ARGUMENT for every customer on every plan, taking photo analysis
   * and OCR down entirely while text-only calls kept working.
   */
  it("no image_url in the AI service passes a bare URL", () => {
    const src = read("apps/api/src/domains/ai/service.ts");
    const sites = src.match(/image_url:\s*\{\s*url:[^}]*\}/g) ?? [];
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) expect(site).toContain("inlineImageAsDataUrl");
  });
});

describe("family: every AI entry point is plan-gated", () => {
  /*
   * These calls cost real money on our own Gemini key and /v1/rpc is reachable
   * with nothing but a session, so a hidden button is not a control. Three
   * services shipped with no check at all, letting a cancelled account generate
   * reports and run OCR indefinitely.
   */
  it("no exported AI service skips the subscription check", () => {
    const src = read("apps/api/src/domains/ai/service.ts");
    const lines = src.split("\n");
    const ungated: string[] = [];
    lines.forEach((line, i) => {
      const m = line.match(/^export async function (\w+Service)/);
      if (!m) return;
      const body = lines.slice(i, i + 20).join("\n");
      if (!/requireActiveSub|getCallerTeamPlan/.test(body)) ungated.push(m[1]);
    });
    expect(ungated).toEqual([]);
  });
});

describe("family: a new public table must revoke anon", () => {
  /*
   * Supabase ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON
   * TABLES TO anon`, so a newly created public table is readable by the
   * publishable key — which is in the browser bundle — the moment it exists.
   * That is exactly how `walkthroughs`, `walkthrough_photos` and `team_invites`
   * leaked, share tokens and invite tokens included.
   */
  it("every migration that creates a public table also revokes anon", () => {
    const dir = join(ROOT, "supabase/migrations");
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, file), "utf8");
      if (!/CREATE TABLE IF NOT EXISTS public\.|CREATE TABLE public\./i.test(sql)) continue;
      // Only the migrations written once the leak was understood are held to
      // this — retrofitting it onto the historical ones is what 20260811000000
      // already did, in one place, for the tables that were actually exposed.
      if (file < "20260811") continue;
      if (!/REVOKE\s+(ALL|SELECT)[\s\S]*?FROM\s+[^;]*anon/i.test(sql)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
