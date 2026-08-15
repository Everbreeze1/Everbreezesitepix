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
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /document_templates.*seed\.sql$/.test(f))
    .sort();
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

const PARSED = parseSeeds();

/**
 * One row per slug, the way the database holds it.
 *
 * Every seed is `ON CONFLICT (slug) DO UPDATE`, and migrations apply in
 * filename order, so a later file rewriting a template is the live version of
 * it and the earlier body no longer exists anywhere. Folding here means these
 * tests read what a tech actually opens, rather than a body that was
 * superseded two migrations ago.
 */
const SEEDED: SeededTemplate[] = (() => {
  const bySlug = new Map<string, SeededTemplate>();
  for (const t of PARSED) bySlug.set(t.slug, t);
  return [...bySlug.values()];
})();

/** The one trade order both template screens sort by. */
const CATEGORIES_SRC = readFileSync(join(ROOT, "apps/web/src/lib/template-categories.ts"), "utf8");
const CATEGORY_ORDER_MATCH = /export const CATEGORY_ORDER = \[([\s\S]*?)\]/.exec(CATEGORIES_SRC);
const CATEGORY_ORDER_SRC = CATEGORY_ORDER_MATCH?.[1] ?? "";

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

  it("uses one slug per template within a migration", () => {
    // ON CONFLICT (slug) DO UPDATE - two rows sharing a slug in one file means
    // the second silently overwrites the first and one template just never
    // exists. Across files it is deliberate: that is how a template is revised.
    for (const file of new Set(PARSED.map((t) => t.file))) {
      const slugs = PARSED.filter((t) => t.file === file).map((t) => t.slug);
      expect(slugs.length, `${file} repeats a slug`).toBe(new Set(slugs).size);
    }
  });

  it("covers the three trades that had nothing addressed to them", () => {
    // Electrical, HVAC and plumbing crews had to start from a generic site
    // report and retype their readings block on every call.
    for (const trade of ["Electrical", "HVAC", "Plumbing"]) {
      const forTrade = SEEDED.filter((t) => t.category === trade);
      expect(forTrade.length, `${trade} templates`).toBe(3);
    }
  });

  it("puts every category in the shared trade order", () => {
    /*
     * A category nothing ranks still renders - it sorts after the listed ones -
     * but a trade landing below "Insurance & Adjusting" is exactly the
     * scannability problem the sections were built to fix.
     *
     * One list, read by both the in-project picker and the Templates page that
     * authors the library, so the two cannot group the same templates
     * differently.
     */
    expect(CATEGORY_ORDER_MATCH, "CATEGORY_ORDER not found - did the module change?").toBeTruthy();
    const listed = [...CATEGORY_ORDER_SRC.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
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

describe("the Templates page files the library by trade", () => {
  /*
   * The client's words: "This section should have categories for each trade."
   * The in-project picker had grouped by trade for a while; the page that
   * authors the same library was still one flat grid, so a copy of the HVAC
   * service call sat between a water heater install and a cleaning invoice.
   */
  const PICKER = readFileSync(
    join(ROOT, "apps/web/src/features/projects/components/ChoosePageTemplateDialog.tsx"),
    "utf8",
  );
  const PAGE = readFileSync(
    join(ROOT, "apps/web/src/features/settings/pages/TemplatesPage.tsx"),
    "utf8",
  );

  it("groups by the same trade order the picker uses", () => {
    for (const [file, src] of [
      ["DocumentTemplatesManager", MANAGER],
      ["ChoosePageTemplateDialog", PICKER],
      ["TemplatesPage", PAGE],
    ] as const) {
      expect(src, `${file} defines its own trade order again`).not.toMatch(
        /const CATEGORY_ORDER = \[/,
      );
      expect(src, `${file} does not read the shared trade order`).toMatch(
        /from "@\/lib\/template-categories"/,
      );
      expect(src, `${file} does not sort sections by trade`).toMatch(/categoryRank\(/);
    }
  });

  it("reads the trade off the template body, where the seeds put it", () => {
    // `body.category`, the same key jsonb_build_object writes in the seeds.
    expect(MANAGER).toMatch(/category: typeof raw\.category === "string"/);
    expect(MANAGER).toMatch(/function templateCategory\(/);
  });

  it("lets an author pick a trade for their own template", () => {
    // Otherwise every template a team writes lands in General for good, and
    // the trade sections only ever describe the built-ins.
    expect(MANAGER).toMatch(/setNewCategory/);
    expect(MANAGER).toMatch(
      /category: newCategory === GENERAL_CATEGORY \? undefined : newCategory/,
    );
  });

  it("lets a card be refiled without opening the editor", () => {
    /*
     * The templates that predate trades all sit in General. Moving one had
     * meant opening a full-screen document editor and saving it, which is a lot
     * of ceremony for changing which heading a card appears under.
     */
    expect(MANAGER).toMatch(/function TradeChip\(/);
    expect(MANAGER).toMatch(/async function assignTrade\(/);
    // The stored body is spread, not rebuilt from parseBody - which knows four
    // keys, so rebuilding would drop anything else a template carries.
    expect(MANAGER).toMatch(/\{ \.\.\.\(t\.body as Record<string, unknown>\) \}/);
  });

  it("reads the trade for the blueprint picker without pulling every body", () => {
    /*
     * The blueprint "add a document" dropdown groups by trade too, which needs
     * the category off `body`. Selecting the whole column to read one key would
     * ship the entire built-in library - tens of kilobytes of document HTML per
     * row - on every visit to the Templates page.
     */
    expect(PAGE).toMatch(/select\("id, name, archived, category:body->>category"\)/);
    expect(PAGE).toMatch(/addKind === "document"\s*\?\s*byTrade\(available\)/);
  });
});

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

  it("gives every preset click-to-type blanks instead of delete-me prose", () => {
    /*
     * These are the bodies behind "New template" and "Load sample site logs",
     * so they are the first template most teams ever open. They used to be
     * written as filler sentences - "Item one", "Write your message here…",
     * "Component - measurement / reading - status" - which the author had to
     * select and delete before typing, and which printed verbatim if they
     * forgot. Same complaint as the squiggly tokens, one step earlier.
     */
    for (const p of presets) {
      expect(asCreated(p.html), `preset ${p.key} has nothing to click and type into`).toContain(
        "data-fill-field",
      );
    }
  });

  it("keeps every preset blank short enough to actually convert", () => {
    /*
     * `bracketsToFillFields` captures `[^[\]<>]{1,60}`. A 61-character label is
     * not an error anywhere: the bracket run simply does not match, and the
     * template ships with `[Areas covered, purpose of the visit, ...]` printed
     * as literal text - which is the exact bug the blanks were replacing.
     */
    for (const p of presets) {
      const leftover = [...asCreated(p.html).matchAll(/\[([^\]]{1,120})\]/g)].map((m) => m[1]);
      expect(leftover, `preset ${p.key} left a blank unconverted`).toEqual([]);
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

  it("gives every template at least one click-to-type blank", () => {
    /*
     * The client's words, on being shown the Electrical Installation and Test
     * Report: "This is a nice change from squiggly lines. Please ensure all
     * templates are easy like this."
     *
     * Nine trade templates were authored with blanks and thirteen were not, so
     * which one you picked decided whether the document asked you questions or
     * handed you a grid of bare cells. This is the rule that keeps them level:
     * a template with no blank anywhere is one nobody thought about filling in.
     */
    for (const t of SEEDED) {
      expect(asCreated(t.html), `${t.slug} has nothing to click and type into`).toContain(
        "data-fill-field",
      );
    }
  });

  it("keeps every blank short enough to actually convert", () => {
    /*
     * `bracketsToFillFields` captures `[^[\]<>]{1,60}`. A 61-character label
     * fails silently - the run simply does not match, and the template ships
     * with the bracket text printed as prose, which is the bug the blanks were
     * put there to fix.
     */
    for (const t of SEEDED) {
      const leftover = [...asCreated(t.html).matchAll(/\[([^\]]{1,120})\]/g)].map((m) => m[1]);
      expect(leftover, `${t.slug} left a blank unconverted`).toEqual([]);
    }
  });

  it("leaves no hint text sitting in a cell as though it were the answer", () => {
    /*
     * "Residential / commercial" typed into the Building cell is not a prompt,
     * it is an answer already given - and it prints that way in the customer's
     * PDF unless the inspector notices and deletes it. The wording is worth
     * keeping, so it became the blank's label instead.
     */
    const HINTS = [
      "Residential / commercial",
      "Steep-slope / low-slope",
      "Temp / wind / dry or wet",
      "Temp / wind / conditions",
      "1 clean / 2 grey / 3 black",
    ];
    for (const t of SEEDED) {
      for (const hint of HINTS) {
        expect(t.html, `${t.slug} still prints "${hint}" as cell text`).not.toContain(
          `<td><p>${hint}</p></td>`,
        );
      }
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
