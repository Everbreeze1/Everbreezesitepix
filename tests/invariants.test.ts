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

/**
 * Strip comments before pattern-matching source.
 *
 * Several of the guards below look for a banned call, and the files that used to
 * make that call now carry a comment explaining why they no longer do — so a
 * naive scan matches its own documentation and fails.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("family: soft-delete leakage (photos.deleted_at)", () => {
  // `photos.deleted_at` has no view and no RLS predicate enforcing it, so every
  // read must exclude the trash by hand. These are the picker/stat surfaces
  // that forgot to — a deleted photo reaching one of them ends up embedded in
  // a customer-facing shared report.
  const MUST_FILTER = [
    "apps/web/src/features/projects/pages/ReportBuilderPage.tsx",
    "apps/web/src/features/projects/pages/ProjectPageEditorPage.tsx",
    // The checklist photo picker, which used to live inside ProjectChecklists.tsx
    // and moved here when the runner became its own page (ChecklistDocumentPage).
    // The panel itself no longer reads `photos` at all.
    "apps/web/src/features/projects/components/checklist/checklist-shared.tsx",
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
  //
  // A photo upload writes TWO objects now — the original and the thumbnail
  // generated beside it — so reclaiming a bare `[path]` would still strand half
  // of every failed upload. `photoObjectPaths()` derives both, and asserting on
  // it is what stops a new call site from quietly reverting to one.
  const PHOTO_CASES = [
    "apps/web/src/features/gallery/pages/GalleryPage.tsx",
    "apps/web/src/features/projects/pages/ProjectDetailPage.tsx",
    "apps/web/src/features/projects/components/ProjectWorkflows.tsx",
    // Same move as above: the checklist upload path is now in the shared module
    // the record page and the panel both draw from.
    "apps/web/src/features/projects/components/checklist/checklist-shared.tsx",
  ];
  // Documents have no derived companion object; one path is the whole upload.
  const SINGLE_OBJECT_CASES = ["apps/web/src/features/projects/components/ProjectDocuments.tsx"];

  it.each(PHOTO_CASES)("%s reclaims both photo objects when the insert fails", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/storage[\s\S]{0,80}\.remove\(photoObjectPaths\(/);
    // No reclaim may fall back to the single-object form, or the thumbnail it
    // just wrote is the thing left behind.
    expect(src).not.toMatch(/from\("site-photos"\)\s*\.remove\(\[/);
  });

  it.each(SINGLE_OBJECT_CASES)("%s reclaims the upload when the insert fails", (rel) => {
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

  /*
   * Same exception, same reason, for the two field records.
   *
   * `project_checklists.notes_html` and `project_workflows.notes_html` are
   * written straight from the author's TipTap editor with no write-side
   * validation at all, and `RecordDocument` injects them with
   * dangerouslySetInnerHTML so the write-up can carry headings and lists onto
   * the printed sheet. The share routes are anonymous, so the only thing
   * standing between an author and their customer's browser is this call.
   */
  it("both public field-record services sanitise the notes HTML they return", () => {
    const svc = read("apps/api/src/domains/projects/field-records.ts");
    // One occurrence per service — checklist and workflow.
    expect(svc.match(/notesHtml:\s*sanitizePageHtml\(/g) ?? []).toHaveLength(2);
  });

  /*
   * And the payload must never grow a second HTML field that skips it. Any key
   * ending in `Html` in that file has to be produced by the sanitiser.
   */
  it("no HTML field in the field-record payload bypasses the sanitiser", () => {
    const svc = read("apps/api/src/domains/projects/field-records.ts");
    const assignments = svc.match(/^\s*\w*[Hh]tml:\s*.+$/gm) ?? [];
    const emitted = assignments.filter((line) => !line.includes("string | null"));
    expect(emitted.length).toBeGreaterThan(0);
    for (const line of emitted) expect(line).toContain("sanitizePageHtml(");
  });

  /*
   * The share routes themselves render `RecordDocument`, which is also used
   * inside the authenticated app. If it ever stopped being the single renderer,
   * the sanitised public copy and the trusted in-app copy would diverge — and
   * the public one is the copy that matters.
   */
  it("the public record view renders the shared RecordDocument", () => {
    const view = read("apps/web/src/features/projects/components/PublicRecordView.tsx");
    expect(view).toContain("RecordDocument");
    expect(view).not.toContain("dangerouslySetInnerHTML");
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

describe("family: a read must not collapse failure into an empty result", () => {
  /*
   * `null`/`[]` from a Supabase read means three different things — no rows, RLS
   * filtered everything, or the table is not in this database — and postgrest-js
   * RESOLVES rather than throws, so a missing table arrives as
   * `{ data: null, error: { code: "PGRST205" } }`.
   *
   * A reader that returns early on `error` therefore renders "there is nothing"
   * for all three. That is how blueprint provenance disappeared: the ledger read
   * failed, the component rendered nothing, and a project set up from a blueprint
   * looked exactly like one that never had one — with no console line anywhere.
   *
   * The rule these enforce: every ledger reader has to SAY something when it
   * cannot read, rather than silently returning.
   */
  const LEDGER_READERS = [
    "apps/web/src/hooks/use-project-blueprint-origin.ts",
    "apps/web/src/features/settings/pages/TemplatesPage.tsx",
  ];

  it.each(LEDGER_READERS)("%s reports a failed read instead of swallowing it", (rel) => {
    const src = read(rel);
    // The exact shape that caused the bug: bail out of the effect on `error`
    // without setting any state or logging anything.
    expect(src).not.toMatch(/if\s*\(\s*cancelled\s*\|\|\s*error\s*\)\s*return;/);
    expect(src).toMatch(/console\.(warn|error)\(/);
  });

  it("the blueprint origin component distinguishes 'none' from 'unavailable'", () => {
    const src = read("apps/web/src/features/projects/components/ProjectBlueprintOrigin.tsx");
    expect(src).toMatch(/unavailable/);
    // Badge it, never hide it — an unreadable ledger must still render something.
    expect(src).toMatch(/Blueprint origin unavailable/);
  });

  it("the blueprint apply tells the caller whether provenance was recorded", () => {
    const service = read("apps/api/src/domains/blueprints/service.ts");
    expect(service).toMatch(/ledgerRecorded/);
    // And the two callers have to look at it, or it is decoration.
    expect(read("apps/web/src/features/settings/components/ApplyBlueprintDialog.tsx")).toMatch(
      /ledgerRecorded/,
    );
    expect(read("apps/web/src/features/projects/pages/NewProjectPage.tsx")).toMatch(
      /ledgerRecorded/,
    );
  });
});

describe("family: per-item blueprint badges must not key off template_id being set", () => {
  /*
   * `project_checklists.template_id` and `project_workflows.template_id` are also
   * written when a template is applied DIRECTLY, outside any blueprint. Badging
   * on `template_id !== null` would therefore label hand-applied items as
   * blueprint output — a confident, wrong attribution.
   *
   * The badge is driven by the ledger's `itemSources` lookup instead, so it fires
   * only for templates a blueprint applied to this project actually contains.
   */
  const BADGED = [
    "apps/web/src/features/projects/components/ProjectChecklists.tsx",
    "apps/web/src/features/projects/components/ProjectWorkflows.tsx",
  ];

  it.each(BADGED)("%s resolves the badge through blueprintSources", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/BlueprintItemBadge/);
    expect(src).toMatch(/blueprintSources\?\.\[/);
  });

  it("the badge renders nothing without a resolved source", () => {
    const src = read("apps/web/src/features/projects/components/BlueprintItemBadge.tsx");
    expect(src).toMatch(/if\s*\(!source\)\s*return null;/);
  });
});

describe("family: a new column must not be able to break a shipped screen", () => {
  /*
   * Code and migrations do not deploy atomically here — the whole reason
   * 20260811001000_schema_drift_repair.sql exists is that production was found
   * running behind this folder. PostgREST rejects an ENTIRE statement over one
   * unknown column (PGRST204), so naming a brand-new column in a select list
   * takes down the whole query, and naming one in an insert loses the whole row.
   *
   * Adding `project_reports.source_template` to the Reports screen would have
   * blanked that screen on every database still waiting for the migration; and
   * adding blueprint_name/origin to the ledger insert would have STOPPED
   * provenance being recorded where bare rows were being written fine. Both are
   * regressions caused purely by deploy ordering, in features that already
   * worked.
   *
   * The rule: anything touching a column introduced in 20260812000000 has to
   * degrade to the pre-migration shape rather than fail.
   */
  it("the Reports screen falls back to the pre-migration column list", () => {
    const src = read("apps/web/src/features/projects/pages/ReportsIndexPage.tsx");
    expect(src).toMatch(/BASE_COLUMNS/);
    // The fallback select must not name the new column.
    const fallback = src.slice(src.indexOf("const BASE_COLUMNS"));
    expect(fallback).toMatch(/select\(BASE_COLUMNS\)/);
  });

  it("the blueprint service retries without the columns 20260812000000 adds", () => {
    const src = read("apps/api/src/domains/blueprints/service.ts");
    expect(src).toMatch(/isMissingColumn/);
    // Ledger insert, report insert and the origin read all need the guard.
    const guards = src.match(/isMissingColumn\(/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(4);
  });

  it("isMissingColumn matches what PostgREST actually returns", () => {
    const src = read("apps/api/src/lib/postgrest.ts");
    // PGRST204 is the schema-cache answer; 42703 is Postgres itself. Matching on
    // message text alone is the mistake isMissingTable was born from.
    expect(src).toMatch(/PGRST204/);
    expect(src).toMatch(/42703/);
  });
});

describe("family: people-lists must not read profiles from the browser", () => {
  /*
   * public.profiles has exactly ONE SELECT policy — "Users can view own profile"
   * USING (auth.uid() = id), 20260618045310_profiles_company_fix.sql. Any
   * browser-side `.from("profiles").select(...).in("id", …)` therefore returns a
   * single row: the caller's own. It never errors and never renders an empty
   * state, so the failure is silent — the assignee dropdown quietly contained
   * one person, avatar stacks filled with "?", and the activity feed said
   * "Someone" for the whole crew. That is the "I can never assign anything to
   * Jackson" report.
   *
   * Teammate names come from the getMyTeam RPC, which resolves them server-side
   * with the service-role client. Widening the RLS policy was rejected: a policy
   * is row-level, not column-level, and profiles also carries company_address,
   * company_phone and company_logo_url — a teammate-scoped policy would hand
   * every crew member the owner's business details to fix a dropdown.
   */
  it("no component resolves a list of OTHER users through profiles", () => {
    const offenders: string[] = [];
    for (const file of walk(WEB)) {
      const src = stripComments(readFileSync(file, "utf8"));
      // `.in("id", …)` on profiles is the tell: selecting many ids only makes
      // sense for other people, and only ever returns yourself.
      if (/from\(\s*["']profiles["']\s*\)[\s\S]{0,200}?\.in\(\s*["']id["']/.test(src)) {
        offenders.push(
          file
            .slice(ROOT.length + 1)
            .split("\\")
            .join("/"),
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the shared roster hook goes through the team RPC, not the table", () => {
    const src = read("apps/web/src/hooks/use-team-members.ts");
    expect(src).toMatch(/getMyTeam/);
    expect(src).not.toMatch(/from\(\s*["']profiles["']/);
  });
});

describe("family: an email that did not send must not be reported as success", () => {
  /*
   * inviteMemberService delegated 100% to GoTrue's inviteUserByEmail, which
   * refuses — and sends NOTHING — for an address that already has an account,
   * for a rate-limited address, and for any error from the Send Email hook. All
   * three returned { sent: false } with no second attempt, while the client
   * wrapped both branches in toast.success. So the UI announced an invite it had
   * not delivered, then rendered "Invite link (email not sent)" underneath.
   */
  it("the invite service sends its own mail and never provisions a GoTrue user", () => {
    const src = read("apps/api/src/domains/teams/service.ts");
    expect(src).toMatch(/sendTeamInviteEmail/);
    /*
     * inviteUserByEmail CREATES an auth user for the invited address. That
     * account has no password, so a brand-new invitee could not sign in — and
     * when they followed the invite link, acceptInviteSignup either 409d with
     * "an account already exists" or failed inside createUser. Inviting someone
     * who had no account created a ghost that blocked them from making a real
     * one, which is the exact case an invite exists to serve.
     */
    expect(stripComments(src)).not.toMatch(/inviteUserByEmail/);
    // The old shape leaked "this address is already registered" to the caller,
    // which is account enumeration; the fallback removes the need to say it.
    expect(src).not.toMatch(/alreadyRegistered:\s*true/);
  });

  it("the invite UI does not claim success on a failed send", () => {
    const src = read("apps/web/src/features/teams/pages/TeamsPage.tsx");
    // Neither toast.success call may sit on the falsy side of an emailSent
    // ternary — the old code did exactly that, twice.
    expect(src).not.toMatch(/toast\.success\(\s*\n?\s*res\.emailSent\s*\?/);
    expect(src).not.toMatch(/toast\.success\(\s*\n?\s*\(res as any\)\?\.emailSent\s*\?/);
    expect(src).toMatch(/toast\.warning\(/);
  });
});

describe("family: the seat ceiling is hidden on Team, shown on Starter and Pro", () => {
  /*
   * Team ships 50 seats — a number nobody approaches, which reads as a
   * restriction on the one plan whose pitch is "add the crew". Starter (2) and
   * Pro are different: there the remaining count is actionable. Hiding it is a
   * display change only; PLAN_MEMBER_CAP still enforces the cap server-side.
   */
  it("every seat-count surface branches on the plan", () => {
    const teams = read("apps/web/src/features/teams/pages/TeamsPage.tsx");
    // The big "3 / 50" and the invite dialog sentence.
    expect(teams).toMatch(/plan === "team" \? seatsUsed : `\$\{seatsUsed\} \/ \$\{memberLimit\}`/);
    expect(teams).toMatch(/They'll join your workspace as soon as they accept\./);

    const settings = read("apps/web/src/features/settings/pages/SettingsPage.tsx");
    expect(settings).toMatch(/isTeam \? seatsUsed : `\$\{seatsUsed\} of \$\{seatsLimit\}`/);
  });

  it("hiding the number does not disable enforcement", () => {
    const cap = read("apps/api/src/lib/team-plan.ts");
    expect(cap).toMatch(/PLAN_MEMBER_CAP/);
    expect(cap).toMatch(/team:\s*\d+/);
  });
});

describe("family: the PDF text renderer must be able to start a new page", () => {
  /*
   * `drawRuns` used to take a bare `PDFPage`, which made it structurally
   * incapable of adding one: it decremented `y` with no comparison to the
   * bottom margin and kept calling `drawText` at ever-smaller coordinates. Past
   * roughly 600 words in a section body, lines were emitted at NEGATIVE y —
   * which pdf-lib writes happily and every viewer clips away. The prose was
   * gone from the client's PDF while the preview still showed all of it, and
   * the page count never grew to hint that anything was missing.
   *
   * The fix is the `Surface` indirection: it owns the page, so it can swap in a
   * fresh one mid-paragraph. Captions keep a non-paginating `fixedSurface`
   * because they draw into fixed-size photo cells.
   */
  const PDF = "apps/api/src/domains/reports/public-pdf.ts";

  it("drawRuns and drawRichBlocks take a Surface, not a PDFPage", () => {
    const src = read(PDF);
    expect(src).toMatch(/function drawRuns\(surface: Surface/);
    expect(src).toMatch(/function drawRichBlocks\(surface: Surface/);
    expect(src).not.toMatch(/function drawRuns\(page: PDFPage/);
    expect(src).not.toMatch(/function drawRichBlocks\(page: PDFPage/);
  });

  it("every line asks for room before it is drawn", () => {
    const src = stripComments(read(PDF));
    // The guard lives in drawRuns' flush(); without it the renderer silently
    // draws off-page again.
    expect(src).toMatch(/surface\.ensure\(/);
    expect(src).toMatch(/const at = surface\.ensure\(y, lineHeight\)/);
  });

  it("the block chain is total, so a pageBreak can never be silently skipped", () => {
    expect(stripComments(read(PDF))).toMatch(/b\.type === "pageBreak"/);
  });

  it("photo captions keep a non-paginating surface", () => {
    // Paginating mid-cell would tear a photo grid across sheets.
    const src = read(PDF);
    expect(src).toMatch(/function fixedSurface/);
    expect(src).toMatch(/drawRichBlocks\(fixedSurface\(page\)/);
  });
});

describe("family: preview, share and PDF must agree on page boundaries", () => {
  /*
   * The PDF's old rule was `!(i === 0 && py > PAGE_H * 0.55)` — a font-metrics
   * cursor test that no DOM renderer can reproduce, so the preview's page count
   * and the downloaded file's could differ, and the PDF's would change when you
   * added a sentence. `planSectionPages` is data-only and both execute it.
   */
  it("both renderers call planSectionPages", () => {
    expect(read("apps/api/src/domains/reports/public-pdf.ts")).toMatch(/planSectionPages/);
    expect(read("apps/web/src/components/ReportDocument.tsx")).toMatch(/planSectionPages/);
  });

  it("the cursor heuristic is gone from the PDF", () => {
    expect(stripComments(read("apps/api/src/domains/reports/public-pdf.ts"))).not.toMatch(
      /PAGE_H \* 0\.55/,
    );
  });

  it("the page rule uses no font metrics, so it is reproducible in a browser", () => {
    const src = read("packages/shared/src/report-pagination.ts");
    expect(src).not.toMatch(/widthOfTextAtSize|measureText|getBoundingClientRect/);
  });
});

describe("family: a drag handle must actually drag", () => {
  /*
   * The report builder rendered a `GripVertical` icon on every section card for
   * as long as the screen existed, with no DndContext, no useSortable and no
   * listeners anywhere in the file. It advertised a drag that did nothing,
   * while the only working reorder was a pair of chevrons in the opposite
   * corner of the same card. Seven other screens already used dnd-kit; this one
   * was the outlier.
   *
   * The rule: if a file renders a grip icon, it must also wire the drag.
   */
  it("every screen showing a grip icon has real sortable wiring", () => {
    const offenders: string[] = [];
    for (const file of ALL_WEB_FILES) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (!/<GripVertical\b/.test(src)) continue;
      const wired = /useSortable\s*\(/.test(src) && /\{\s*\.\.\.listeners\s*\}/.test(src);
      /*
       * Two legitimate shapes that are not dnd-kit call sites:
       *  - a presentational handle that spreads `{...props}` onto the element,
       *    so whoever renders it supplies the listeners (builder-ui's Handle);
       *  - react-resizable-panels, whose <Separator> is itself the drag target
       *    (the shadcn ResizableHandle).
       */
      const viaProps =
        /listeners\s*[?:]/.test(src) ||
        /dragHandleProps/.test(src) ||
        /\{\s*\.\.\.props\s*\}/.test(src);
      const viaResizablePanels = /react-resizable-panels/.test(src);
      if (!wired && !viaProps && !viaResizablePanels) {
        offenders.push(
          file
            .slice(ROOT.length + 1)
            .split("\\")
            .join("/"),
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("family: report photo order is editable, because it decides page layout", () => {
  /*
   * Every renderer consumes `section.photos` positionally and batches it
   * `photosPerPage` at a time, so the sequence decides which photos share a
   * page. The builder could append, caption and remove — but never reorder, so
   * moving photo 5 ahead of photo 2 meant deleting everything after it and
   * re-adding, which also discarded the captions.
   */
  const BUILDER = "apps/web/src/features/projects/pages/ReportBuilderPage.tsx";

  it("the builder can reorder photos within a section", () => {
    expect(stripComments(read(BUILDER))).toMatch(/function movePhoto\(/);
  });

  it("removing a photo offers its caption back", () => {
    // Removal used to destroy typed prose with no undo and no confirmation.
    const src = stripComments(read(BUILDER));
    expect(src).toMatch(/label:\s*["']Undo["']/);
  });
});

describe("family: only capture paths may hide a photo from the gallery", () => {
  /*
   * `photos.phase = "walkthrough"` removes a photo from the project grid, the
   * global gallery, the calendar, the timeline, dashboards, group cards,
   * showcases and the mobile app — and NOTHING in this codebase ever writes it
   * back. That is correct for a frame captured *during* a recording, which is a
   * recording artefact and was never in the gallery to begin with.
   *
   * A Summary is the opposite case: it LINKS photos the user already has and
   * still expects to find in the gallery. Reusing the recorded-walkthrough
   * linker there — the obvious "simplification", since the link rows are
   * otherwise identical — would erase real photos from the customer's product
   * everywhere but the summary itself, permanently and with no undo path.
   *
   * Hence the summary services write `walkthrough_photos` directly. This guard
   * is the enforcement point for that, because nothing else is.
   */
  const SERVICE = "apps/api/src/domains/walkthroughs/service.ts";

  const summaryServiceSource = () => {
    const src = read(SERVICE);
    const start = src.indexOf("export async function generateWalkthroughSummaryService");
    const end = src.indexOf("export async function saveWalkthroughPhotoService");
    expect(start, "generateWalkthroughSummaryService not found").toBeGreaterThan(-1);
    expect(end, "saveWalkthroughPhotoService not found").toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it("the summary services never set photos.phase", () => {
    expect(stripComments(summaryServiceSource())).not.toMatch(/phase:\s*["']walkthrough["']/);
  });

  it("the summary services never call the recorded-walkthrough photo linker", () => {
    // That helper sets phase="walkthrough" on every id handed to it.
    expect(stripComments(summaryServiceSource())).not.toMatch(
      /ensureWalkthroughPhotoLinksService\s*\(/,
    );
  });

  it("a summary can never burn an Auto Report slot", () => {
    /*
     * Summary is available on any active plan; Auto Reports are Pro/Team and
     * metered. reserveAutoReport throws for a non-Pro caller, so reaching it
     * from a summary row would paywall a user for regenerating something they
     * already own. The guard must sit BEFORE the reservation, not after.
     */
    const src = stripComments(read(SERVICE));
    const guard = src.indexOf('(walk as any).source === "summary"');
    const reserve = src.indexOf("await reserveAutoReport(");
    expect(guard, "summary guard missing from generateWalkthroughReportService").toBeGreaterThan(
      -1,
    );
    expect(reserve).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(reserve);
  });

  it("recorded-only operations refuse a summary row", () => {
    // Each of these would corrupt a summary: a capture frame attached to it, a
    // video path on something with no video, or a finish-session overwriting
    // its AI body with a transcript fallback built from a null transcript.
    const src = stripComments(read(SERVICE));
    const refusals = src.match(/\(walk as any\)\.source !== "recorded"/g) ?? [];
    expect(refusals.length).toBeGreaterThanOrEqual(3);
  });
});

describe("family: rpcOp names are strings the compiler cannot check", () => {
  /*
   * A client op is declared as rpcOp<In, Out>("someName"). The generic argument
   * is type-checked against the service, but the NAME is a bare string matched
   * against registry.ts at runtime. Mistype it — or rename the registry key and
   * miss a call site — and everything compiles, the build passes, the tests
   * pass, and the feature 404s the first time a user clicks the button.
   *
   * There is no shared constant to import and no codegen step, so this scan is
   * the only thing standing between a one-character typo and a dead feature.
   */
  const CLIENT_DIR = join(ROOT, "apps/web/src/lib");

  it("every rpcOp name exists as a key in the RPC registry", () => {
    const registry = read("apps/api/src/domains/rpc/registry.ts");
    // Keys are declared at two-space indent, wrapped in authed(, pub(, or a
    // bare object literal — so match the key itself, not the wrapper.
    const keys = new Set([...registry.matchAll(/^ {2}([a-zA-Z0-9_]+):/gm)].map((m) => m[1]));
    expect(keys.size).toBeGreaterThan(100);

    const orphans: string[] = [];
    let total = 0;
    for (const file of readdirSync(CLIENT_DIR).filter((f) => f.endsWith(".functions.ts"))) {
      const src = readFileSync(join(CLIENT_DIR, file), "utf8");
      for (const m of src.matchAll(/>\(\s*["']([a-zA-Z0-9_]+)["']/g)) {
        total++;
        if (!keys.has(m[1])) orphans.push(`${file} -> ${m[1]}`);
      }
    }
    // Guard against the scan silently matching nothing and passing vacuously.
    expect(total).toBeGreaterThan(100);
    expect(orphans).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Autosave must never write a value it did not mean to write.
 * ---------------------------------------------------------------------------
 */

describe("ProjectPageEditorPage autosave", () => {
  const editor = () => read("apps/web/src/features/projects/pages/ProjectPageEditorPage.tsx");

  /*
   * `useDebouncedValue` seeds its state with the value from the FIRST render —
   * for the document body that is the empty string the editor mounts with,
   * before the fetched content is ever put into it. The title debounces at
   * 800ms and the three bodies at 1200ms, so the title's tick fired a save
   * 400ms before the body's tick had replaced that empty seed, and the save
   * carried it: opening a document blanked its stored `content_html` until the
   * next tick put it back. Anything that stopped the second write — a closed
   * tab, a dropped connection, a 409 — made it permanent, and a failed load
   * (which also ends with an empty editor and `loading` false) blanked it with
   * no window at all.
   *
   * The debounced values are triggers. The payload is read at request time.
   */
  it("sends values read at request time, never the debounced snapshots", () => {
    const src = editor();
    expect(src).toMatch(/const latest = latestRef\.current/);
    expect(src).toMatch(/contentHtml:\s*latest\.html/);
    expect(src).toMatch(/headerHtml:\s*latest\.showHeader\s*\?\s*latest\.headerHtml\s*:\s*null/);
    expect(src).toMatch(/footerHtml:\s*latest\.showFooter\s*\?\s*latest\.footerHtml\s*:\s*null/);
    expect(src).toMatch(/title:\s*titleToSave\s*\|\|\s*undefined/);
    expect(src).toMatch(/const titleToSave = latest\.title\.trim\(\)/);

    // The debounced values may schedule a save, but must not be the payload.
    for (const stale of [
      "debouncedHtml",
      "debouncedHeaderHtml",
      "debouncedFooterHtml",
      "debouncedTitle",
    ]) {
      expect(src).not.toMatch(
        new RegExp(`(contentHtml|headerHtml|footerHtml|title):\\s*${stale}\\b`),
      );
      expect(src).not.toMatch(new RegExp(`${stale}\\.trim\\(\\)`));
    }
  });

  /*
   * Opening a document produces debounce ticks of its own. Acting on them
   * rewrote the row on every visit — moving "Last updated" and burning an
   * optimistic-concurrency version for a document nobody touched.
   */
  it("does not write until the user has actually edited something", () => {
    expect(editor()).toMatch(/if \(!dirtyRef\.current\) return;/);
  });

  /*
   * A save that started before the user's last keystroke used to clear
   * `unsavedRef` on the way back, so the leave-confirmation and the
   * beforeunload guard both stopped protecting an edit that was never written.
   */
  it("only clears the unsaved flag when no edit landed mid-flight", () => {
    const src = editor();
    expect(src).toMatch(/const savedAt = editCountRef\.current/);
    expect(src).toMatch(/if \(editCountRef\.current === savedAt\) unsavedRef\.current = false/);
    // The unconditional clear must be gone.
    expect(src).not.toMatch(/^\s*unsavedRef\.current = false;\s*$/m);
  });

  /*
   * The document HTML is serialised lazily now, keyed on `docVersion`, because
   * `getHTML()` walks the whole document and used to run on every render.
   *
   * That makes the load path load-bearing: `setContent` passes
   * `emitUpdate: false` so `onUpdate` — the thing that normally bumps
   * `docVersion` — deliberately does NOT fire. If the manual bump beside it
   * ever goes away, `html` keeps the empty string the editor mounted with and
   * the blanking bug walks back in through a different door.
   */
  it("re-serialises the document after load, despite emitUpdate: false", () => {
    const src = editor();
    expect(src).toMatch(/useMemo\(\(\) => editor\?\.getHTML\(\) \?\? "", \[editor, docVersion\]\)/);
    const fromSetContent = src.slice(src.indexOf("setContent(res.page.content_html"));
    const beforeCatch = fromSetContent.slice(0, fromSetContent.indexOf("} catch"));
    expect(beforeCatch).toMatch(/setDocVersion\(\(n\) => n \+ 1\)/);
  });
});

describe("a photo slot's declared box survives out of the editor", () => {
  /*
   * The box is carried by TWO halves that must stay together:
   *
   *   size — an inline style from ProjectImage.renderHTML, because the HTML
   *          width/height attributes lose to Tailwind's preflight
   *          `img { height: auto }` wherever stored HTML is rendered directly.
   *   crop — `object-fit: cover` from CSS.
   *
   * Keep only the size and photos STRETCH to fill the box. Keep only the crop
   * and the box collapses to the photo's natural aspect, which is the bug this
   * fixed: a slot declaring 280px rendered 127px on the shared page.
   */
  it("renderHTML serialises the size", () => {
    const src = read("apps/web/src/lib/tiptap-project-image.ts");
    expect(src).toMatch(/renderHTML\(\{\s*HTMLAttributes\s*\}\)/);
    expect(src).toMatch(/style:\s*`width:\$\{w\};height:\$\{h\}`/);
  });

  it("every surface that renders stored HTML supplies the crop", () => {
    const css = read("apps/web/src/styles.css");
    expect(css).toMatch(/\.tiptap img\[width\]\[height\]\s*\{[^}]*object-fit:\s*cover/);
    // The template designer opts out of `.tiptap` and restates the rules itself.
    const designer = read("apps/web/src/features/settings/components/DocumentTemplatesManager.tsx");
    expect(designer).toMatch(/\.doc-page img\[width\]\[height\]\s*\{[^}]*object-fit:\s*cover/);
  });
});

describe("ProjectPageEditorPage photo slot click", () => {
  const editor = () => read("apps/web/src/features/projects/pages/ProjectPageEditorPage.tsx");

  /*
   * Measured in Chromium against the running app: pressing on a photo slot and
   * releasing 9px away emits `mousedown, dragstart, dragend` — no mouseup and
   * no click at all — because ProseMirror marks image nodes draggable and sets
   * `draggable` on the NodeView wrapper. The slot therefore ignored every
   * gesture except a perfectly still click, and the photo the user reached for
   * next (via the toolbar) landed beside the still-empty box. Cancelling the
   * drag restores the mouseup/click pair; verified 3px/9px/25px wobbles all
   * open the picker afterwards.
   *
   * Only unfilled slots are undraggable — real photos keep drag-to-reorder.
   */
  it("cancels the native drag on unfilled slots so the click survives", () => {
    const src = editor();
    const props = src.slice(src.indexOf("handleDOMEvents"), src.indexOf("attributes: {"));
    expect(props).toMatch(/dragstart:/);
    expect(props).toMatch(/isPhotoSlot\(node\.attrs\)/);
    expect(props).toMatch(/event\.preventDefault\(\)/);
  });

  /*
   * The click itself is a real DOM `click`, not ProseMirror's `handleClickOn`,
   * which it abandons past 4px of pointer travel (MouseDown.updateAllowDefault).
   */
  it("opens the picker from a DOM click, not handleClickOn", () => {
    const src = editor();
    expect(src).toMatch(/click: \(view: EditorView, event: MouseEvent\)/);
    expect(src).not.toMatch(/handleClickOn:/);
  });

  /*
   * The picker's photos are signed URLs with a one-hour life, resolved once at
   * mount. Documents stay open far longer, and past the hour every thumbnail
   * 403s and picking one writes a dead `src` into the document. This branch is
   * time-gated, so it is guarded here rather than exercised in a browser: the
   * refresh must key off how old the signatures are, not off a bare mount.
   */
  it("re-signs stale photo URLs before showing the picker", () => {
    const src = editor();
    expect(src).toMatch(/photosLoadedAtRef/);
    expect(src).toMatch(/PHOTO_URL_TTL_SECONDS/);
    // The signing lifetime and the staleness threshold must come from the same
    // constant, or they drift apart and the refresh stops covering the window.
    expect(src).toMatch(/createSignedUrls\(toSign, PHOTO_URL_TTL_SECONDS\)/);
    expect(src).toMatch(/age > \(PHOTO_URL_TTL_SECONDS - \d+\) \* 1000/);
  });
});

describe("ProjectPageEditorPage actions that read the stored row", () => {
  const editor = () => read("apps/web/src/features/projects/pages/ProjectPageEditorPage.tsx");

  /** Body of a component-scope `function name(` up to its closing 2-space brace. */
  function fnBody(src: string, name: string): string {
    const start = src.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n  }\n", start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  /*
   * Both build from `project_pages.content_html` server-side — page-pdf.ts
   * re-reads the row, and savePageAsTemplateService reads `page.content_html`.
   * The editor autosaves on a 1.2s debounce, so either one run straight after
   * typing produced a PDF, or a template, of the document as it was BEFORE the
   * last edit. Nothing said so; you just got the wrong file.
   */
  it.each(["handleExport", "handleSaveAsTemplate"])(
    "%s flushes pending saves before reading the stored row",
    (fn) => {
      expect(fnBody(editor(), fn)).toMatch(/await flushPendingSave\(\)/);
    },
  );

  /*
   * The bin icon sits one row from "Use", snippets are a shared library, and
   * there is no trash and no undo behind this call — so deleting must be asked
   * about first.
   *
   * The confirmation is INLINE, in the row. A confirm dialog opened from inside
   * the snippets dialog renders in its own portal, so Radix reads a click
   * inside it as an interaction outside the snippets dialog and dismisses the
   * library behind it — measured in Chromium: cancelling the delete threw you
   * out of the snippet list entirely. Keep this to one layer.
   */
  it("asks before deleting a snippet, without opening a second dialog", () => {
    const src = editor();
    expect(src).toMatch(/confirmingDelete/);
    expect(src).toMatch(/setConfirmingDelete\(s\.id\)/);
    // The trash button must not delete directly, and must not open a dialog.
    expect(fnBody(src, "handleDeleteSnippet")).not.toMatch(/await confirm\(/);
    expect(src).toMatch(/onClick=\{\(\) => void handleDeleteSnippet\(s\.id\)\}/);
  });

  /*
   * navigator.clipboard rejects outside a secure context and, in some browsers,
   * when the document isn't focused. Unhandled that was a silent no-op plus an
   * unhandled rejection.
   */
  it("handles clipboard failure when copying the share link", () => {
    expect(fnBody(editor(), "copyShareLink")).toMatch(/catch\s*\{/);
  });
});

describe("family: a summary must not claim a recording it never had", () => {
  /*
   * A summary walkthrough has no video, no narration and no timeline: every
   * linked photo carries offset_seconds 0 and spoken_note null. Any surface
   * that renders a walkthrough therefore has two modes, and the recorded copy
   * is actively false in the other one — "0:00" implies a timestamp inside a
   * recording, and "no narration captured" apologises for the absence of
   * something that was never possible.
   *
   * This was found by generating a real summary and reading the rendered page
   * and the produced PDF, not by reading the code — three separate surfaces had
   * the same defect and each one had to be branched independently. That is why
   * this guard enumerates surfaces rather than checking a single call site.
   */
  const surfaces: Array<[string, string]> = [
    ["web photo steps + markdown", "apps/web/src/components/WalkthroughReport.tsx"],
    [
      "walkthrough detail page",
      "apps/web/src/features/walkthroughs/pages/WalkthroughDetailPage.tsx",
    ],
    ["public share page", "apps/web/src/routes/share.walkthroughs.$token.tsx"],
    ["public PDF", "apps/api/src/domains/walkthroughs/public-pdf.ts"],
  ];

  for (const [label, file] of surfaces) {
    it(`${label} branches on summary vs recorded`, () => {
      const src = stripComments(read(file));
      expect(src).toMatch(
        /isSummary|variant\s*===\s*["']summary["']|source\s*===\s*["']summary["']/,
      );
    });
  }

  it("the PDF does not print a recording timestamp on a summary photo", () => {
    // Regression: the cover page was branched but the photo pages were not, so
    // every tile read "Photo 1 · 0:00" on a document with no recording.
    const src = stripComments(read("apps/api/src/domains/walkthroughs/public-pdf.ts"));
    const photoLabel = src.match(/`Photo \$\{idx\}[^`]*`/g) ?? [];
    expect(photoLabel.length).toBeGreaterThan(0);
    // The offset-bearing variant must be guarded by isSummary somewhere in the
    // same expression, i.e. it can't be the unconditional argument to drawText.
    expect(src).toMatch(/isSummary\s*\?\s*`Photo \$\{idx\}`/);
  });

  it("the PDF suppresses the missing-narration note on a summary", () => {
    const src = stripComments(read("apps/api/src/domains/walkthroughs/public-pdf.ts"));
    expect(src).toMatch(/else if \(!isSummary\)[\s\S]{0,200}No spoken note captured/);
  });
});

describe("family: summary copy and layout must not inherit recording assumptions", () => {
  /*
   * Found by generating a real summary and reading the rendered page, the
   * public share page and the produced PDF. Each defect below shipped through
   * typecheck, build and the full test suite, because none of them is a type
   * error — they are true statements about a recording printed on a document
   * that never had one.
   */

  it("the summary markdown builder drops filename-only captions", () => {
    /*
     * An unedited upload's caption is its filename. The PDF's cover-summary
     * extractor pulls running prose out of this markdown, so an unfiltered
     * caption printed "1 (9).jpg" as a sentence on a client-facing cover.
     * public-pdf.ts already guards its own photo pages with looksLikeFilename.
     */
    const src = stripComments(read("apps/api/src/domains/walkthroughs/service.ts"));
    expect(src).toMatch(/looksLikeFilenameCaption/);
    expect(src).toMatch(/if \(caption && !looksLikeFilenameCaption\(caption\)\)/);
  });

  it("the delete prompt tells a summary's owner their photos are safe", () => {
    // A summary links the user's real gallery photos; "cannot be undone" alone
    // reads as though deleting it destroys them too.
    const src = stripComments(
      read("apps/web/src/features/walkthroughs/pages/WalkthroughDetailPage.tsx"),
    );
    expect(src).toMatch(/isSummary[\s\S]{0,120}photos are not affected/);
  });

  it("pricing does not sell 'Walkthroughs' as Pro-only", () => {
    /*
     * Summary generation keeps the any-active-plan gate but files into the
     * Walkthroughs tab, so a bare "Walkthroughs" bullet under Pro is false for
     * a Starter user who owns one. Recording is the part Pro unlocks.
     */
    const src = stripComments(read("apps/web/src/lib/pricing.ts"));
    expect(src).not.toMatch(/["']Walkthroughs \+/);
    expect(src).toMatch(/Recorded walkthroughs/);
  });
});

describe("family: prose-* classes are inert in this app", () => {
  /*
   * @tailwindcss/typography is NOT installed, so every `prose-h2:uppercase`,
   * `prose-li:my-1` etc. is a no-op while Tailwind's preflight still strips
   * heading sizes, block margins and list markers. styles.css already says this
   * for the `.tiptap` block; the walkthrough/summary markdown had the same bug,
   * rendering AI headings at body size and bullets with no markers.
   */
  it("the typography plugin really is absent (this guard's premise)", () => {
    const pkgs = ["package.json", "apps/web/package.json"].map(read).join("\n");
    expect(pkgs).not.toMatch(/@tailwindcss\/typography/);
  });

  it("walkthrough markdown styles itself instead of relying on prose-*", () => {
    const src = read("apps/web/src/components/WalkthroughReport.tsx");
    expect(src).toMatch(/wt-markdown/);
    // The inert utility soup must not come back on this block.
    expect(src).not.toMatch(/prose-h2:uppercase/);
  });

  it("the wt-markdown rules actually exist in the stylesheet", () => {
    const css = read("apps/web/src/styles.css");
    for (const sel of [".wt-markdown h2", ".wt-markdown ul", ".wt-markdown li", ".wt-markdown p"]) {
      expect(css).toContain(sel);
    }
    expect(css).toMatch(/\.wt-markdown ul \{[^}]*list-style: disc/);
  });
});

describe("family: a rich-text toolbar button must not steal focus from its editor", () => {
  /*
   * Pressing a toolbar button moves focus out of the contenteditable, which
   * fires the editor's `onBlur`. `RichTextEditor` renders its toolbar only while
   * focused when `toolbarOnFocus` is set, so React unmounted the toolbar BETWEEN
   * mousedown and mouseup — no click event ever landed and the command never
   * ran. Every control in the document header, the document footer and both
   * field-record write-ups was inert: it highlighted on hover and did nothing.
   *
   * Invisible to types and to unit tests; found by clicking Bold in a real
   * browser and counting zero `<strong>` elements afterwards. Suppressing the
   * default mousedown is the fix, and funnelling every control through one
   * component is what stops the next one from forgetting.
   */
  it("RichTextEditor suppresses the default mousedown on its toolbar controls", () => {
    const src = read("apps/web/src/components/RichTextEditor.tsx");
    expect(src).toMatch(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  });

  it("every toolbar control goes through the single guarded button", () => {
    const src = read("apps/web/src/components/RichTextEditor.tsx");
    // Exactly one raw <button> may exist — ToolButton's own. Any other is a
    // control that bypassed the guard.
    expect(src.match(/<button\b/g) ?? []).toHaveLength(1);
    // And it is the one carrying the guard.
    const btn = src.slice(src.indexOf("<button"), src.indexOf("</button>"));
    expect(btn).toContain("onMouseDown");
  });

  it("the editors that render their toolbar on focus are the ones this protects", () => {
    // If this list empties, the guard above is no longer load-bearing and the
    // reasoning in its comment should be revisited rather than silently kept.
    const users = [
      "apps/web/src/features/projects/pages/ProjectPageEditorPage.tsx",
      "apps/web/src/features/projects/pages/ChecklistDocumentPage.tsx",
      "apps/web/src/features/projects/components/ProjectWorkflows.tsx",
    ];
    for (const rel of users) expect(read(rel)).toContain("toolbarOnFocus");
  });
});

describe("family: a record's permission model must stay three separate questions", () => {
  /*
   * `ChecklistDocumentPage` distinguishes three things that are easy to collapse
   * into one boolean, and collapsing them is how a teammate loses the ability to
   * do the job they were assigned:
   *
   *   owned        — did I put this checklist on the project? (authoring right)
   *   canStructure — owned AND not sealed  (add / reorder / delete / rename)
   *   canFill      — not sealed            (tick, answer, attach a photo)
   *
   * A teammate is deliberately NOT the owner but MUST still be able to fill the
   * record in — that is the entire point of assigning one. Gating the checkbox on
   * ownership instead of `canFill` would hand them a read-only page; gating the
   * composer on `canFill` instead of `canStructure` would let anyone restructure
   * somebody else's checklist. Sealing overrides both, because the snapshot is
   * the compliance record.
   *
   * Asserted as source text because this path cannot be exercised without a
   * second authenticated account, so nothing else in the suite touches it.
   */
  const REL = "apps/web/src/features/projects/pages/ChecklistDocumentPage.tsx";

  it("the three flags are derived, not conflated", () => {
    const src = read(REL);
    expect(src).toMatch(
      /const owned\s*=\s*!!user && !!checklist && checklist\.created_by === user\.id/,
    );
    expect(src).toMatch(/const canStructure\s*=\s*owned && !sealed/);
    expect(src).toMatch(/const canFill\s*=\s*!sealed/);
  });

  it("filling in the record is gated on canFill, never on ownership", () => {
    const src = read(REL);
    // The tick box and the answer widget are the two things a teammate needs.
    expect(src).toMatch(/disabled=\{!canFill\}/);
    expect(src).toMatch(/readOnly=\{!canFill\}/);
    // Neither may be gated on `owned`, which would lock out the assignee.
    expect(src).not.toMatch(/disabled=\{!owned\}/);
    expect(src).not.toMatch(/readOnly=\{!owned\}/);
  });

  it("restructuring the record is gated on canStructure", () => {
    const src = read(REL);
    // The add-item composer and the per-row edit menu are structural.
    expect(src).toMatch(/\{canStructure && \(/);
    // A non-owner is told why, rather than silently losing the controls.
    expect(src).toContain("Fill only");
  });

  it("a sealed record is read-only on every path", () => {
    const src = read(REL);
    // Both derived flags fall to false once `sealed` is true, so one assertion
    // on each is enough — but `sealed` itself must come from completed_at.
    expect(src).toMatch(/const sealed\s*=\s*!!checklist\?\.completed_at/);
  });
});
