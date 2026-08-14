import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { sanitizePageHtml } from "../apps/api/src/domains/projects/sanitize-page-html";
import { bracketsToFillFields, SUPPORTED_TOKENS } from "../apps/api/src/domains/projects/pages";

/*
 * The built-in template library is authored in SQL and never type-checked by
 * anything. A template only becomes wrong at the moment a tech applies it on a
 * roof - by which point the damage is a document handed to a customer with
 * `{{client_name}}` printed in it, or a checklist with no tick boxes.
 *
 * These parse the seed migrations and put every template through the exact code
 * path `createPageFromTemplateService` uses: sanitize, then bracket-to-field.
 * Whatever survives that is what the customer sees.
 */

const ROOT = resolve(__dirname, "..");
const MIGRATIONS = join(ROOT, "supabase/migrations");

interface SeededTemplate {
  file: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  html: string;
}

/** SQL string literal - `''` is an escaped quote, not a terminator. */
function unquote(raw: string): string {
  return raw.replace(/''/g, "'");
}

function parseSeeds(): SeededTemplate[] {
  const files = readdirSync(MIGRATIONS).filter((f) => /document_templates.*seed\.sql$/.test(f));
  const out: SeededTemplate[] = [];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const block of sql.split("INSERT INTO public.document_templates").slice(1)) {
      const slug = /VALUES\s*\(\s*'((?:[^']|'')*)'/.exec(block);
      const name = /NULL,\s*NULL,\s*'((?:[^']|'')*)'/.exec(block);
      const html = /'html',\s*\$html\$([\s\S]*?)\$html\$/.exec(block);
      if (!slug || !name || !html) continue;
      const category = /'category',\s*'((?:[^']|'')*)'/.exec(block);
      const description = /'description',\s*'((?:[^']|'')*)'/.exec(block);
      out.push({
        file,
        slug: unquote(slug[1]),
        name: unquote(name[1]),
        category: category ? unquote(category[1]) : null,
        description: description ? unquote(description[1]) : null,
        html: html[1],
      });
    }
  }
  return out;
}

const SEEDED = parseSeeds();

/** What `createPageFromTemplateService` actually writes into project_pages. */
const asCreated = (html: string) => bracketsToFillFields(sanitizePageHtml(html)) ?? "";

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the built-in template library - what the seed migrations contain", () => {
  it("parses (guards the parser these tests depend on)", () => {
    expect(SEEDED.length).toBeGreaterThanOrEqual(21);
  });

  it("gives every template a category, a description and a body", () => {
    /*
     * ChoosePageTemplateDialog groups by category and shows the description as
     * the row's subtitle. A template missing either renders as an unlabelled
     * row under a heading it does not belong to.
     */
    for (const t of SEEDED) {
      expect(t.category, `${t.slug} has no category`).toBeTruthy();
      expect(t.description, `${t.slug} has no description`).toBeTruthy();
      expect(t.html.length, `${t.slug} has an empty body`).toBeGreaterThan(200);
    }
  });

  it("uses one slug per template", () => {
    // ON CONFLICT (slug) DO UPDATE - two rows sharing a slug means the second
    // silently overwrites the first and one template just never exists.
    const slugs = SEEDED.map((t) => t.slug);
    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it("covers the three trades that had nothing addressed to them", () => {
    // Electrical, HVAC and plumbing crews had to start from a generic site
    // report and retype their readings block on every call.
    for (const trade of ["Electrical", "HVAC", "Plumbing"]) {
      const forTrade = SEEDED.filter((t) => t.category === trade);
      expect(forTrade.length, `${trade} templates`).toBe(3);
    }
  });

  it("puts every category in the picker's trade order", () => {
    /*
     * A category the dialog does not know still renders - it sorts after the
     * listed ones - but a trade landing below "Insurance & Adjusting" is
     * exactly the scannability problem the sections were built to fix.
     */
    const dialog = readFileSync(
      join(ROOT, "apps/web/src/features/projects/components/ChoosePageTemplateDialog.tsx"),
      "utf8",
    );
    const order = /const CATEGORY_ORDER = \[([\s\S]*?)\]/.exec(dialog);
    expect(order, "CATEGORY_ORDER not found - did the dialog change?").toBeTruthy();
    const listed = [...order![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    for (const category of new Set(SEEDED.map((t) => t.category))) {
      expect(listed, `category ${category} is seeded but unranked in the dialog`).toContain(
        category,
      );
    }
  });

  it("only uses merge tokens the resolver knows", () => {
    /*
     * A token outside `SUPPORTED_TOKENS` still degrades to a labelled blank
     * rather than printing as `{{whatever}}` - but the label is guessed from
     * the token name, so `{{jobsite_addr}}` reads as "Jobsite addr" in a
     * document sent to a customer. The library gets the curated labels.
     */
    expect(SUPPORTED_TOKENS.has("project_name"), "token set is empty").toBe(true);

    for (const t of SEEDED) {
      for (const [, token] of t.html.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
        expect(
          SUPPORTED_TOKENS.has(token.toLowerCase()),
          `${t.slug} uses unknown token {{${token}}}`,
        ).toBe(true);
      }
    }
  });
});

/*
 * The presets in DocumentTemplatesManager are the other half of the library:
 * "New template" and "Load sample site logs" write these bodies straight into
 * `document_templates`, and they are never parsed by anything above.
 *
 * They are how the bug arrived. `sitelog_walkthrough` merges {{weather}},
 * {{client_name}}, {{project_number}} and {{prepared_by_title}} - four fields
 * `loadTokenValues` had never heard of - so applying it to a project produced a
 * document with all four printed as raw `{{tokens}}`, which is what the client
 * reported. The seed migrations were covered by the test above; these were not.
 */
const MANAGER = readFileSync(
  join(ROOT, "apps/web/src/features/settings/components/DocumentTemplatesManager.tsx"),
  "utf8",
);

describe("the style presets the Templates page writes", () => {
  const presets = [...MANAGER.matchAll(/key: "(\w+)",[\s\S]*?html: `([\s\S]*?)`,\n  \},/g)].map(
    (m) => ({ key: m[1], html: m[2] }),
  );

  it("parses (guards the parser these tests depend on)", () => {
    expect(presets.length).toBeGreaterThanOrEqual(9);
    expect(presets.some((p) => p.key === "sitelog_walkthrough")).toBe(true);
  });

  it("only uses merge tokens the resolver knows", () => {
    for (const p of presets) {
      for (const [, token] of p.html.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
        expect(
          SUPPORTED_TOKENS.has(token.toLowerCase()),
          `preset ${p.key} uses unknown token {{${token}}}`,
        ).toBe(true);
      }
    }
  });

  it("offers every placeholder the page advertises", () => {
    // The Fields panel lists these as insertable, so each has to be a field
    // the resolver can fill or ask for.
    const advertised = [...MANAGER.matchAll(/\{ token: "(\w+)", label: "/g)].map((m) => m[1]);
    expect(advertised.length).toBeGreaterThan(0);
    for (const token of advertised) {
      expect(SUPPORTED_TOKENS.has(token), `placeholder ${token} is offered but unsupported`).toBe(
        true,
      );
    }
  });
});

describe("the built-in template library - what survives being applied to a page", () => {
  it("keeps every photo slot clickable", () => {
    // `isPhotoSlot` keys off the `data:image/svg+xml` src. Lose it and the
    // "Tap to add photo" box becomes a decorative image nothing can fill.
    for (const t of SEEDED) {
      const before = count(t.html, "data:image/svg+xml");
      const after = count(asCreated(t.html), "data:image/svg+xml");
      expect(after, `${t.slug} lost photo slots`).toBe(before);
    }
    expect(SEEDED.some((t) => count(t.html, "data:image/svg+xml") > 0)).toBe(true);
  });

  it("keeps every checklist tickable", () => {
    /*
     * The regression this exists for: `allowedAttributes` dropped `data-type`,
     * so `<ul data-type="taskList">` arrived as a plain `<ul>`. TipTap's task
     * list keys off that attribute and styles.css only draws a tick box for
     * `ul[data-type="taskList"]` - so a trade checklist silently became
     * bullets, permanently, since the sanitised HTML is what gets written.
     */
    for (const t of SEEDED) {
      const before = count(t.html, 'data-type="taskList"');
      const after = count(asCreated(t.html), 'data-type="taskList"');
      expect(after, `${t.slug} lost its checklists`).toBe(before);
      expect(count(asCreated(t.html), 'data-type="taskItem"')).toBe(
        count(t.html, 'data-type="taskItem"'),
      );
    }
    expect(SEEDED.some((t) => count(t.html, 'data-type="taskList"') > 0)).toBe(true);
  });

  it("keeps every table intact", () => {
    for (const t of SEEDED) {
      const created = asCreated(t.html);
      expect(count(created, "<table"), `${t.slug} lost tables`).toBe(count(t.html, "<table"));
      expect(count(created, "<th"), `${t.slug} lost header cells`).toBe(count(t.html, "<th"));
    }
  });

  it("turns [Bracketed] blanks into click-to-type fields, not literal text", () => {
    const withBlanks = SEEDED.filter((t) => /<[^>]*>[^<]*\[[^\]]+\]/.test(t.html));
    expect(withBlanks.length, "no template uses bracket blanks").toBeGreaterThan(0);
    for (const t of withBlanks) {
      expect(asCreated(t.html), `${t.slug} left a blank as literal text`).toContain(
        "data-fill-field",
      );
    }
  });

  it("does not turn a photo slot's alt text into a fill field", () => {
    // `alt="Photo slot 1"` is an attribute value; rewriting inside one would
    // emit a `<span>` into the middle of an `<img>` tag.
    for (const t of SEEDED) {
      expect(asCreated(t.html)).not.toMatch(/alt="[^"]*<span/);
    }
  });
});
