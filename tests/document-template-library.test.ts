import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { sanitizePageHtml } from "../apps/api/src/domains/projects/sanitize-page-html";
import {
  bracketsToFillFields,
  fieldLabel,
  SUPPORTED_TOKENS,
} from "../apps/api/src/domains/projects/pages";
import { nextCopyName } from "../apps/web/src/lib/duplicate-name";

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
 * "New template" writes these bodies straight into `document_templates`, and
 * they are never parsed by anything above.
 *
 * They are how the bug arrived. `sitelog_walkthrough` merged {{weather}},
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
      /*
       * `categoryRank` is the fixed order; `makeCategoryRank` is the same
       * order with the company's own trades lifted to the front, and the two
       * template screens use it once the setup wizard has been answered.
       * Either counts as "sorts by trade" - what must not happen is a screen
       * ordering the library some third way.
       */
      expect(src, `${file} does not sort sections by trade`).toMatch(/categoryRank\(/i);
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
    const select = /\.select\("(id, name, archived[^"]*)"\)/.exec(PAGE)?.[1];
    expect(select, "the document template select changed shape").toBeTruthy();
    // Named keys off the jsonb, never the column itself.
    expect(select).toContain("category:body->>category");
    expect(select).not.toMatch(/(^|,)\s*body\s*(,|$)/);
    expect(PAGE).toMatch(/addKind === "document"\s*\?\s*byTrade\(available\)/);
  });
});

describe("the style presets the Templates page writes", () => {
  /**
   * `${PHOTO_SLOT}` and friends, resolved against the consts declared in the
   * same file. The preset bodies interpolate them, and every check below reads
   * the finished document, so an unresolved `${...}` would quietly turn a photo
   * slot into a piece of literal text that no assertion here would notice.
   */
  const resolve = (html: string) =>
    html.replace(/\$\{(\w+)\}/g, (whole, name: string) => {
      const decl = new RegExp(`const ${name} =\\s*\n?\\s*"([^"]*)";`).exec(MANAGER);
      return decl ? decl[1] : whole;
    });

  // `{2}` rather than two literal spaces: the indent is what closes the preset
  // object in the source, and two spaces in a regex are unreadable (no-regex-spaces).
  const presets = [...MANAGER.matchAll(/key: "(\w+)",[\s\S]*?html: `([\s\S]*?)`,\n {2}\},/g)].map(
    (m) => ({ key: m[1], html: resolve(m[2]) }),
  );

  it("parses (guards the parser these tests depend on)", () => {
    expect(presets.length).toBeGreaterThanOrEqual(6);
    expect(presets.map((p) => p.key)).toEqual([
      "report",
      "letter",
      "checklist",
      "memo",
      "walkthrough",
      "sitelog",
    ]);
    for (const p of presets) {
      expect(p.html, `preset ${p.key} left an unresolved interpolation`).not.toContain("${");
    }
  });

  it("does not ship a second, worse copy of a library document", () => {
    /*
     * The client, on Templates > Documents: "Some of the recent ones you have
     * made look nice and editable but some of the other ones with garbage can
     * are terrible."
     *
     * The garbage can is the tell. A built-in is `team_id IS NULL` and RLS
     * makes it read-only, so its card has no delete; a team's own row has one.
     * "Load sample site logs" wrote three team-owned copies of the presets, and
     * those copies were the terrible ones - plain heading-and-bullet documents
     * standing next to a library of laid-out ones, and the only cards on the
     * page that looked editable.
     *
     * Every one of the three is covered better by a built-in that ships in the
     * library, so the button went rather than being rewritten. Anyone wanting
     * an editable sample duplicates a built-in, which starts from the good body.
     */
    expect(MANAGER).not.toContain("loadSampleSiteLogs");
    expect(MANAGER).not.toContain("Load sample site logs");
    for (const key of ["sitelog_basic", "sitelog_walkthrough", "sitelog_hvac"]) {
      expect(
        presets.some((p) => p.key === key),
        `${key} is back`,
      ).toBe(false);
    }
  });

  it("starts a team's own template at the same standard as the library", () => {
    /*
     * The other half of the same complaint, and the half that would let it come
     * back: both sets of documents land in one grid on this page, so a preset
     * that is a bare run of `<h1>` over `<ul>` reads as the shoddy tier no
     * matter how good the seeded library gets.
     *
     * These are the shape the library is built from: a grid to fill rather
     * than a bullet list, and the grey meta and guidance lines that carry the
     * instructions instead of filler prose sitting in the document body.
     */
    for (const p of presets) {
      expect(p.html, `preset ${p.key} has no table to fill in`).toContain("<table");
      expect(p.html, `preset ${p.key} has no header cells`).toContain("<th");
      expect(p.html, `preset ${p.key} has no styled meta or guidance line`).toContain(
        'style="color: rgb(',
      );
    }
  });

  it("gives the on-site styles somewhere to put the photos", () => {
    /*
     * A field report, a checklist recap, a walkthrough and a daily log are all
     * documents whose evidence is photographs. The seeded ones lay out tappable
     * slots; the presets used to say "List key photos captured today with brief
     * captions" and leave the author to it. Letter and memo are correspondence
     * and are deliberately exempt.
     */
    for (const key of ["report", "checklist", "walkthrough", "sitelog"]) {
      const p = presets.find((x) => x.key === key);
      expect(p, `preset ${key} is missing`).toBeTruthy();
      expect(p!.html, `preset ${key} has no photo slots`).toContain("data:image/svg+xml");
      expect(count(asCreated(p!.html), "data:image/svg+xml"), `${key} lost photo slots`).toBe(
        count(p!.html, "data:image/svg+xml"),
      );
    }
  });

  it("keeps every preset table intact through sanitising", () => {
    // Same guard the seeded library gets: `allowedAttributes` dropping a table
    // attribute turns a grid into a run of paragraphs, permanently, because the
    // sanitised HTML is what gets written to the page.
    for (const p of presets) {
      const created = asCreated(p.html);
      expect(count(created, "<table"), `preset ${p.key} lost tables`).toBe(count(p.html, "<table"));
      expect(count(created, "<th"), `preset ${p.key} lost header cells`).toBe(count(p.html, "<th"));
    }
  });

  it("leaves no filler prose sitting where an answer belongs", () => {
    /*
     * "Item one", "Component - measurement / reading - status", "Write your
     * memo body here" - all text an author had to select and delete before
     * typing, and all of it printed verbatim into a customer's PDF if they
     * forgot. 20260826000000_repair_team_document_templates.sql exists to undo
     * exactly this in rows that were already written from these bodies.
     */
    const FILLER = [
      "Item one",
      "Item two",
      "First action",
      "Second action",
      "Follow-up needed",
      "Write your me",
      "Describe the",
      "Component - measurement",
      "Task one -",
      "Photo 1 - caption",
    ];
    for (const p of presets) {
      for (const filler of FILLER) {
        expect(p.html, `preset ${p.key} still ships "${filler}"`).not.toContain(filler);
      }
    }
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

  it("names every chip the same thing as the merge tag it writes", () => {
    /*
     * The client's report: 'clicking a Fields panel chip like "Job title"
     * inserts a merge tag named {{prepared_by_title}}, which doesn't match its
     * own label and would confuse anyone debugging the raw template later.'
     *
     * So the rule is that the token IS the label, lowercased and joined with
     * underscores. Strong on purpose: the panel is the only place a token is
     * ever given a friendly name, and the template it writes gets read later by
     * somebody who has nothing in front of them but the raw HTML.
     */
    const chips = [...MANAGER.matchAll(/\{ token: "(\w+)", label: "([^"]+)"/g)];
    expect(chips.length).toBeGreaterThan(6);
    for (const [, token, label] of chips) {
      const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      expect(slug, `chip "${label}" inserts {{${token}}}`).toBe(token);
    }
  });

  it("calls a field the same thing in the panel and in the finished document", () => {
    // The panel's label and the [Blank] the resolver leaves behind are the same
    // words, so the person authoring the template and the customer holding the
    // PDF are looking at one name for one field.
    const chips = [...MANAGER.matchAll(/\{ token: "(\w+)", label: "([^"]+)"/g)];
    for (const [, token, label] of chips) {
      expect(fieldLabel(token), `${token} is labelled twice over`).toBe(label);
    }
  });

  it("still resolves the merge tag every existing template was written with", () => {
    /*
     * `prepared_by_title` is the name `job_title` went by first. It is all over
     * the seed migrations and in every template a team wrote before the rename,
     * and a token the resolver has never heard of prints as [Prepared by title]
     * in front of a customer. It is not offered any more; it still works.
     */
    expect(SUPPORTED_TOKENS.has("prepared_by_title")).toBe(true);
    expect(fieldLabel("prepared_by_title")).toBe("Job title");
    expect(fieldLabel("job_title")).toBe("Job title");
  });

  it("keeps authoring a template on a desktop, and using one everywhere", () => {
    /*
     * "This feature can be only used on desktop ... Mobile can apply templates
     * and use it." Every route that opens the editor checks the screen first;
     * the route that applies a template to a project does not.
     */
    // Comments stripped: this component quotes the client's old wording back at
    // itself all over the place, and a comment is not a gate.
    const src = MANAGER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).toContain("function editorNeedsDesktop()");
    for (const opener of ["setCreateOpen(true)", "void edit(t)", "void copyForEditing(t)"]) {
      const at = src.indexOf(opener);
      expect(at, `${opener} is not in the component any more`).toBeGreaterThan(0);
      const before = src.slice(Math.max(0, at - 400), at);
      expect(before, `${opener} opens the editor without checking the screen`).toContain(
        "editorNeedsDesktop()",
      );
    }
    // Using a template is untouched: nothing between the button and openUse.
    const useAt = src.indexOf("openUse(t)");
    expect(useAt).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, useAt - 400), useAt)).not.toContain("editorNeedsDesktop");
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

/*
 * ---------------------------------------------------------------------------
 * The client's report: "There is massive duplication ... it gets duplicated in
 * the documents section."
 * ---------------------------------------------------------------------------
 *
 * They were reading a real page. Their team library held eleven rows for three
 * documents - "Basic site log", "Detailed walkthrough log" and "HVAC /
 * construction log", each present three or four times, every copy byte
 * identical to the next. Their explanation (that using a template in a project
 * and editing it there wrote a copy back) was wrong; nothing on the project
 * page path writes to `document_templates`. Two things in this screen did:
 *
 *   1. a "Load sample site logs" button that inserted the same three rows on
 *      every click, with no check for the rows it had already written. Removed,
 *      and `20260903000000_retire_superseded_team_document_templates.sql`
 *      archives what it left behind;
 *   2. "Duplicate", which appended " (copy)" unconditionally - so a second
 *      duplicate became "... (copy) (copy)". Both live on the database.
 *
 * The tests below hold each of those shut.
 */
describe("the library cannot refill itself with duplicates", () => {
  it("no button inserts a fixed set of templates", () => {
    /*
     * The shape that caused it: an insert of an array built from the presets,
     * rather than of a single row the user named. Matching on the button's copy
     * as well, since that is what a reintroduction would most likely bring back.
     */
    // The button's own label, and the handler behind it.
    expect(MANAGER).not.toMatch(/Load sample site logs/i);
    expect(MANAGER).not.toMatch(/loadSampleSiteLogs/);
    // The three preset bodies it wrote. Only the keys are checked, not every
    // mention: the comments in that file explain what these styles were and why
    // they went, and that history is worth keeping readable.
    expect(MANAGER).not.toMatch(/key: "sitelog_(basic|walkthrough|hvac)"/);
  });

  it("every insert into document_templates names exactly one row", () => {
    const inserts = [
      ...MANAGER.matchAll(/from\("document_templates" as any\)\s*\n\s*\.insert\(([\s\S]{0,80})/g),
    ];
    expect(inserts.length).toBeGreaterThan(0);
    for (const [, head] of inserts) {
      // `.insert(rows)` / `.insert([...])` is a bulk write; `.insert({` is one row.
      expect(head.trimStart().startsWith("{"), `bulk insert: ${head.trim().slice(0, 40)}`).toBe(
        true,
      );
    }
  });

  it("duplicate() numbers the copy instead of stacking a suffix", () => {
    expect(MANAGER).toContain("nextCopyName(");
    expect(MANAGER).not.toMatch(/name: `\$\{t\.name\} \(copy\)`/);
  });
});

describe("nextCopyName", () => {
  it("names a first copy the way it always did", () => {
    expect(nextCopyName("Site Report", ["Site Report"])).toBe("Site Report (copy)");
  });

  it("numbers instead of stacking (copy) (copy)", () => {
    const taken = ["Site Report", "Site Report (copy)"];
    expect(nextCopyName("Site Report (copy)", taken)).toBe("Site Report (copy 2)");
    expect(nextCopyName("Site Report", taken)).toBe("Site Report (copy 2)");
  });

  it("keeps counting past the second copy", () => {
    const taken = ["Site Report", "Site Report (copy)", "Site Report (copy 2)"];
    expect(nextCopyName("Site Report (copy 2)", taken)).toBe("Site Report (copy 3)");
  });

  it("flattens a chain written before the fix", () => {
    // The live row, duplicated once more.
    expect(
      nextCopyName("HVAC Service Call Report (copy) (copy)", [
        "HVAC Service Call Report",
        "HVAC Service Call Report (copy)",
        "HVAC Service Call Report (copy) (copy)",
      ]),
    ).toBe("HVAC Service Call Report (copy 2)");
  });

  it("ignores case and padding when deciding a name is taken", () => {
    expect(nextCopyName("Site Report", ["  site report (COPY)  "])).toBe("Site Report (copy 2)");
  });

  it("never returns an empty name", () => {
    expect(nextCopyName("(copy)", [])).toBe("Untitled document (copy)");
    expect(nextCopyName("   ", [])).toBe("Untitled document (copy)");
  });

  it("leaves a name that merely mentions copy alone", () => {
    expect(nextCopyName("Copy of the roof plan", [])).toBe("Copy of the roof plan (copy)");
  });
});

/*
 * ---------------------------------------------------------------------------
 * "this is a report template that i am forced to edit. Very bad looking.
 *  Crowded."
 * ---------------------------------------------------------------------------
 *
 * The screenshot showed nine placeholder inputs in a four-column grid inside
 * the document, and the same nine again down the Fields panel on the right -
 * two sets of boxes for one set of values, both bound to `sampleOverrides`.
 * They are now split across the `md` breakpoint so only one can ever render.
 */
describe("the template editor shows each field in one place", () => {
  it("the quick-fields strip and the Fields panel never render together", () => {
    const strip = /quickFields\.length > 0 && \(\s*\n\s*<div className="([^"]+)"/.exec(MANAGER);
    expect(strip, "quick fields strip not found").not.toBeNull();
    expect(strip![1]).toContain("md:hidden");

    const panel = /<aside className="([^"]+)"/.exec(MANAGER);
    expect(panel, "fields panel not found").not.toBeNull();
    expect(panel![1]).toContain("hidden");
    expect(panel![1]).toContain("md:block");
  });

  it("the Fields panel lists its inputs in one column", () => {
    // Two columns inside a 320px panel truncates both the labels and the values.
    const body = MANAGER.slice(MANAGER.indexOf("Editable fields"));
    expect(body.slice(0, 1400)).not.toContain("grid-cols-2");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The residual duplication, and the two things that now stop it.
 * ---------------------------------------------------------------------------
 *
 * 20260903000000 archived the copies that matched a shipped preset. What it
 * could not reach was a copy of a document the team wrote themselves, which on
 * the live database left four cards holding two documents:
 *
 *   HVAC Service Call Report (copy) / ... (copy) (copy)
 *   Template July 31st Tire Buster Auto Report / ... (copy)
 *
 * 20260904000000 collapses those, and the card badge stops the next set being
 * invisible. The two have to agree on what "the same document" means - the body,
 * never the name - or the page will badge a card the sweep keeps, or worse,
 * quietly archive one it never warned about.
 */
describe("duplicate copies are collapsed and surfaced", () => {
  const SWEEP = readFileSync(
    join(MIGRATIONS, "20260904000000_archive_duplicate_team_document_templates.sql"),
    "utf8",
  );

  it("the sweep keeps one row per identical body, per team", () => {
    // Partitioning on team_id as well as the body: two teams holding the same
    // document is two teams, not a duplicate.
    expect(SWEEP).toMatch(/PARTITION BY team_id, md5\(body ->> 'html'\)/);
    // Oldest survives, deterministically.
    expect(SWEEP).toMatch(/ORDER BY created_at, id/);
    expect(SWEEP).toMatch(/r\.copy_rank > 1/);
  });

  it("the sweep never touches the built-in library", () => {
    expect(SWEEP).toMatch(/team_id IS NOT NULL/);
  });

  it("the sweep archives rather than deletes", () => {
    expect(SWEEP).toMatch(/SET archived = true/);
    expect(SWEEP).not.toMatch(/DELETE\s+FROM/i);
  });

  it("re-running it is a no-op", () => {
    // Already-archived rows fall out of the candidate set, so a second run
    // cannot walk the survivors down to one.
    expect(SWEEP).toMatch(/archived = false/);
  });

  it("the card badge and the sweep agree on what a duplicate is", () => {
    /*
     * Both compare the stored body and nothing else. A badge keyed on the name
     * would mark "CLEANING SERVICES - Invoice With Photos (copy)", a document of
     * its own that merely says copy in its name, and would miss the Tire Buster
     * pair if either were renamed.
     */
    const block = MANAGER.slice(
      MANAGER.indexOf("const duplicateOf"),
      MANAGER.indexOf("const sections"),
    );
    expect(block.length).toBeGreaterThan(200);
    expect(block).toContain("parseBody(t.body).html");
    expect(block).not.toMatch(/\.name\b[^)]*\bnormalize|COPY_SUFFIX|\(copy\)/);
    // Built-ins are excluded on both sides.
    expect(block).toContain("t.team_id === null");
    // Oldest is the keeper on both sides.
    expect(block).toContain("created_at.localeCompare");
  });

  it("only the redundant cards are badged, never the one worth keeping", () => {
    const block = MANAGER.slice(
      MANAGER.indexOf("const duplicateOf"),
      MANAGER.indexOf("const sections"),
    );
    // The keeper is destructured off the front and only `rest` is recorded.
    expect(block).toMatch(/const \[keeper, \.\.\.rest\]/);
    expect(block).toMatch(/for \(const dupe of rest\) out\.set\(dupe\.id, keeper\.name\)/);
  });
});

/*
 * The client, reading the Documents tab of the Templates page:
 *
 *   "I am not sure what the point of duplicating is ... Clean templates should
 *    be allowed to be applied to projects. projects document section. Creating
 *    duplicates is a big mess."
 *
 * The earlier round of work here treated the symptom - numbering copies,
 * badging identical bodies, archiving the ones already in the database. This
 * covers the cause: a grid that offered copying as a co-equal verb to using,
 * and on a built-in labelled it "Duplicate to edit", which states that a
 * template must be copied before it can be changed. It must not: a document is
 * tailored for one job by using the template in that project and editing the
 * page it creates, which touches no template at all.
 */
describe("copying is not how a template gets used", () => {
  const EDITOR_PAGE = readFileSync(
    join(ROOT, "apps/web/src/features/projects/pages/ProjectPageEditorPage.tsx"),
    "utf8",
  );
  const PAGE_SRC = readFileSync(
    join(ROOT, "apps/web/src/features/settings/pages/TemplatesPage.tsx"),
    "utf8",
  );

  /**
   * The file with its comments removed, so an assertion about what the page
   * SAYS is not answered by prose explaining what it used to say - the comments
   * in this component quote the old labels on purpose.
   */
  const rendered = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("the card leads with using the template, not copying it", () => {
    expect(MANAGER).toContain("Use in a project");
    // The label that taught the wrong model. Copying a built-in is still
    // offered; it just no longer claims to be the way to edit one.
    expect(rendered(MANAGER)).not.toContain("Duplicate to edit");
  });

  it("Edit works on a built-in, and the copy behind it is not the user's problem", () => {
    /*
     * A built-in belongs to no team and RLS refuses the write, so editing one
     * has to produce a row of the team's own. The page used to hand that
     * constraint to the user as a button reading "Duplicate to edit". Now Edit
     * is on every card and the copy happens underneath.
     */
    const block = MANAGER.slice(
      MANAGER.indexOf("async function edit("),
      MANAGER.indexOf("async function copyForEditing"),
    );
    expect(block.length).toBeGreaterThan(100);
    expect(block).toMatch(/if \(t\.team_id !== null\) return openForEdit\(t\)/);
    expect(block).toContain("copyForEditing(t)");
    /*
     * The Edit button is no longer withheld from examples, and Duplicate is no
     * longer offered on them - there is nothing left for it to do there.
     *
     * Asserted on the guard in front of Edit rather than on the button's own
     * markup: it is several lines of JSX now that tapping it on a phone has to
     * explain itself instead of opening the editor, and a test that pins the
     * formatting of a button is a test that fails the next time someone styles
     * it.
     */
    const src = rendered(MANAGER);
    const editAt = src.indexOf("/> Edit");
    expect(editAt, "no Edit button on the card").toBeGreaterThan(0);
    const guardAt = src.lastIndexOf("{canManage", editAt);
    expect(guardAt, "Edit is not behind canManage").toBeGreaterThan(0);
    expect(src.slice(guardAt, editAt), "Edit is gated on isExample again").not.toContain(
      "isExample",
    );
    expect(src).toMatch(/canManage && !isExample && \(\s*<DropdownMenu>/);
  });

  it("the company's version replaces the example instead of joining it", () => {
    /*
     * The whole point. Without this the grid grows a card every time someone
     * edits an example, which is the duplication the client reported wearing a
     * different hat.
     */
    const copy = MANAGER.slice(
      MANAGER.indexOf("async function copyForEditing"),
      MANAGER.indexOf("async function closeEditor"),
    );
    // Provenance recorded, and only for an example: a copy of the team's own
    // template is a second template and both belong on the page.
    expect(copy).toMatch(/isExample \? \{ \.\.\.\(body as object\), copiedFrom: t\.id \} : body/);
    // It takes the original's name, since the original steps aside.
    expect(copy).toMatch(/isExample && free \? t\.name : nextCopyName\(t\.name, taken\)/);

    const shadow = MANAGER.slice(
      MANAGER.indexOf("const shadowedExamples"),
      MANAGER.indexOf("const visible"),
    );
    // Only a live row shadows, so archiving or deleting the copy brings the
    // example back - which is also the undo for having made one.
    expect(shadow).toMatch(/t\.team_id === null \|\| t\.archived/);
    expect(MANAGER).toMatch(/!\(i\.team_id === null && shadowedExamples\.has\(i\.id\)\)/);
  });

  it("every screen that lists the library applies that rule", () => {
    // Three lists read `document_templates`. A rule applied to two of them is a
    // library that contradicts itself depending on where you look at it.
    const api = readFileSync(join(ROOT, "apps/api/src/domains/projects/page-templates.ts"), "utf8");
    const list = api.slice(
      api.indexOf("export async function listDocumentTemplatesService"),
      api.indexOf("export const getDocumentTemplateInputSchema"),
    );
    expect(list).toMatch(/const shadowed = new Set\(/);
    expect(list).toMatch(/!\(row\.team_id === null && shadowed\.has\(row\.id\)\)/);
    // The blueprint "add a document" dropdown, which is the third.
    expect(PAGE_SRC).toMatch(/copiedFrom:body->>copiedFrom/);
    expect(PAGE_SRC).toMatch(/\.filter\(\(x: any\) => !shadowed\.has\(x\.id\)\)/);
  });

  it("copying opens the editor rather than dropping a twin in the grid", () => {
    /*
     * The old handler ended at the insert: it pushed a byte-identical row into
     * `items` and toasted "Duplicated", so pressing the button to find out what
     * it did left a permanent card indistinguishable from the one it came from.
     */
    const block = MANAGER.slice(
      MANAGER.indexOf("async function copyForEditing"),
      MANAGER.indexOf("async function closeEditor"),
    );
    expect(block.length).toBeGreaterThan(200);
    expect(block).toMatch(/setEditor\(\{[^}]*fresh: true/);
    expect(block).not.toMatch(/setItems\(/);
    expect(block).not.toMatch(/toast\.success\(/);
  });

  it("a copy nobody edited is deleted again when the editor closes", () => {
    const block = MANAGER.slice(
      MANAGER.indexOf("async function closeEditor"),
      MANAGER.indexOf("async function assignTrade"),
    );
    expect(block.length).toBeGreaterThan(200);
    // Only ever a row this session created and never saved.
    expect(block).toMatch(/if \(!open\.fresh \|\| !open\.template\)/);
    expect(block).toMatch(/\.delete\(\)/);
    // Edits that were never saved are still edits: they are confirmed away,
    // not dropped on a stray Escape. That guard covers an ordinary edit too
    // now, so the flag it reads is `edited` rather than `untouched`.
    expect(block).toMatch(/const edited =/);
    expect(block).toMatch(/await confirm\(/);
  });

  it("both ways out of the editor run that cleanup", () => {
    // The X inside the surface, and Escape / the overlay via the Dialog.
    expect(MANAGER).toContain("onClose={() => void closeEditor()}");
    expect(MANAGER).toMatch(/onOpenChange=\{\(v\) => \{[\s\S]{0,400}void closeEditor\(\)/);
  });

  it("a document can improve the template it came from instead of adding one", () => {
    /*
     * The verb that was missing. With only "Save as a new template", a crew
     * that fixed a heading while filling the sheet in on site had one way to
     * keep the fix: a second template beside the wrong one. The library grew
     * every time anyone tidied anything.
     */
    const service = readFileSync(
      join(ROOT, "apps/api/src/domains/projects/page-templates.ts"),
      "utf8",
    );
    const block = service.slice(
      service.indexOf("export async function updateTemplateFromPageService"),
    );
    expect(block.length).toBeGreaterThan(200);

    // Built-ins are shared by every company. RLS rejects the write; this says
    // so in words rather than surfacing a permissions error.
    expect(block).toMatch(/template\.team_id === null/);
    // Only the body's html is replaced. A document retitled for one customer
    // must not rename, refile or restyle the template every job starts from.
    expect(block).toMatch(/\.\.\.\(template\.body && typeof template\.body === "object"/);
    expect(block).not.toMatch(/\.update\(\{[^}]*\bname\b/);

    // Both routes out of a document build the body the same way, so the photo
    // strip, the blanked answers and the values-back-to-tokens pass cannot
    // apply to one and not the other.
    expect(service).toMatch(/async function templateBodyFromPage\(/);
    const saveBlock = service.slice(
      service.indexOf("export async function savePageAsTemplateService"),
      service.indexOf("export const updateTemplateFromPageInputSchema"),
    );
    expect(saveBlock).toContain("templateBodyFromPage(page)");
    expect(block).toContain("templateBodyFromPage(page)");

    // Reachable: registered, and offered by the editor behind a confirmation,
    // since it rewrites what the whole team starts new jobs from.
    const registry = readFileSync(join(ROOT, "apps/api/src/domains/rpc/registry.ts"), "utf8");
    expect(registry).toMatch(/updateTemplateFromPage: authed\(/);
    const editorBlock = EDITOR_PAGE.slice(
      EDITOR_PAGE.indexOf("async function handleUpdateTemplate"),
      EDITOR_PAGE.indexOf("async function handleExport"),
    );
    expect(editorBlock.length).toBeGreaterThan(200);
    expect(editorBlock).toMatch(/await confirm\(/);
    expect(editorBlock).toContain("updateTemplateFromPage({ data: { pageId } })");
    // Never offered for an example, which cannot be written to.
    expect(EDITOR_PAGE).toMatch(/t\.id === sourceTemplateId && !t\.isExample/);
  });

  it("saving a page as a template cannot silently mint a same-named twin", () => {
    /*
     * A page created from a template carries that template's name as its title,
     * and the title was the prompt's default - so accepting it produced a
     * second template with the first one's name, holding one job's version of
     * it. That is the "then another template is created" the client described.
     */
    const block = EDITOR_PAGE.slice(
      EDITOR_PAGE.indexOf("async function handleSaveAsTemplate"),
      EDITOR_PAGE.indexOf("async function handleUpdateTemplate"),
    );
    expect(block.length).toBeGreaterThan(200);
    // The names already in use, via the cache the ··· menu warms.
    expect(block).toMatch(/await ensureLibrary\(\)/);
    expect(EDITOR_PAGE).toContain("listDocumentTemplates()");
    expect(block).toMatch(/defaultValue: clash \? nextCopyName\(title, taken\) : title/);
    // And it says what it is for, since the menu item alone reads like "save".
    expect(block).toMatch(/description:/);
  });
});

/*
 * "i just opened one to fill it out, when i clicked out of it accidentally the
 * whole thing disappeared. I was filling out the header field etc."
 *
 * Two dialogs in this flow hold typing that exists nowhere else until a button
 * is pressed, and both used to dismiss on any click that landed outside them.
 * The rule these pin down is the same for both: a click outside is never
 * destructive, and a deliberate close asks first when there is something to
 * lose - but only then, because a confirmation on every close is a
 * confirmation nobody reads.
 */
const USE_DIALOG = readFileSync(
  join(ROOT, "apps/web/src/features/projects/components/UseTemplateDialog.tsx"),
  "utf8",
);

describe("unsaved work survives a stray click", () => {
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("the fill-in step does not close on a click outside it", () => {
    /*
     * The likeliest surface behind the report: a centred dialog with a 320px
     * column of boxes, so most of a 1440px window is overlay - and the boxes
     * are the document's header fields. Reopening does not bring them back
     * either; the effect keyed on templateId resets all of them.
     */
    const src = stripComments(USE_DIALOG);
    expect(src).toMatch(/onInteractOutside=\{\(e\) => e\.preventDefault\(\)\}/);
  });

  it("...and asks before throwing away what was typed, but only then", () => {
    const src = stripComments(USE_DIALOG);
    // A baseline to compare the title against, or "did they rename it" has no
    // answer and the dialog either always asks or never does.
    expect(src).toContain("suggestedTitle");
    expect(src).toMatch(/const dirty =[\s\S]{0,200}Object\.values\(values\)\.some/);
    // The guard is on the dirty flag, not on every close.
    expect(src).toMatch(/dirty &&\s*!\(await confirm\(/);
    // Escape, the X and Cancel all arrive at the same place.
    expect(src).toMatch(/onOpenChange=\{\(v\) => \{[\s\S]{0,160}requestClose\(\)/);
    expect(src).toMatch(/onClick=\{\(\) => void requestClose\(\)\}/);
  });

  it("the template editor asks before discarding an ordinary edit", () => {
    /*
     * The editor is w-screen/h-screen so there is no overlay to click, but
     * Escape reached the same silent `setEditor(null)`. Only the unsaved-COPY
     * branch ever asked, so editing a template the team already owned lost
     * every keystroke since the last Save without a word.
     */
    const src = stripComments(MANAGER);
    const block = src.slice(
      src.indexOf("async function closeEditor"),
      src.indexOf("async function assignTrade"),
    );
    expect(block.length).toBeGreaterThan(200);
    // Dirtiness is measured against what was loaded, not against the stored
    // row: openForEdit returns sanitised html, so the column never matches.
    expect(block).toMatch(/open\.body\.html !== open\.original\.html/);
    expect(block).toMatch(/open\.name !== open\.original\.name/);
    // Asked for an edit as well as for a copy...
    expect(block).toMatch(/if \(edited\)/);
    expect(block).toContain("Discard your changes?");
    expect(block).toContain("Discard this copy?");
    // ...and not asked at all when nothing was touched.
    expect(block).toMatch(/if \(!open\.fresh \|\| !open\.template\) \{\s*setEditor\(null\)/);
  });

  it("every way into the editor records what it opened with", () => {
    // Without a baseline on all three, one of them would ask on every close.
    const src = stripComments(MANAGER);
    const opens = [...src.matchAll(/setEditor\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
    expect(opens.length).toBeGreaterThanOrEqual(3);
    for (const open of opens) {
      expect(open, `an editor is opened without an original: ${open.slice(0, 80)}`).toContain(
        "original:",
      );
    }
  });

  it("the editor and the New template dialog ignore clicks outside", () => {
    const src = stripComments(MANAGER);
    const guards = [...src.matchAll(/onInteractOutside=\{\(e\) => e\.preventDefault\(\)\}/g)];
    expect(guards.length).toBe(2);
  });
});

/*
 * "we need a clear indication of where the page break is when we Edit these
 * templates. when I edit them I export and the page breaks the paragraph or
 * photo set up. it should be clearly visible on Edit page for that Template."
 *
 * A guide line is only worth drawing if it is telling the truth. The editor
 * used to lay the document out in a 48rem column at 15px while the export used
 * a 0.85in margin at 12pt, so the two wrapped text in different places and
 * there was no honest answer to "where does page 2 start". These pin the page
 * box down as one shared number, and pin the export to it.
 *
 * The geometry itself - that the guides land within a pixel of the boundary -
 * is checked in a real browser by scripts/drive-template-page-breaks.mjs. What
 * a source test can hold is that neither surface grew its own copy of the
 * numbers again.
 */
describe("the editor shows where the printed page ends", () => {
  const PAGE_PDF = readFileSync(join(ROOT, "apps/api/src/domains/projects/page-pdf.ts"), "utf8");

  /**
   * The stylesheet exportPdf writes into the print window.
   *
   * Found forwards from its own @page rule, because ChipStyles closes a
   * <style> of its own earlier in the file - searching for "</style>" from the
   * top lands on that one and returns an empty slice.
   */
  const printCss = () => {
    const from = MANAGER.indexOf("@page { size: Letter");
    expect(from, "exportPdf no longer declares an @page").toBeGreaterThan(0);
    return MANAGER.slice(from, MANAGER.indexOf("</style>", from));
  };

  it("keeps the page box in one place", () => {
    expect(MANAGER).toMatch(/const PAGE_IN = \{ width: 8\.5, height: 11, margin: 0\.75 }/);
    // Derived, not restated: a second literal is how the two drift apart.
    expect(MANAGER).toMatch(/width: PAGE_IN\.width - PAGE_IN\.margin \* 2/);
    expect(MANAGER).toMatch(/height: PAGE_IN\.height - PAGE_IN\.margin \* 2/);
  });

  it("uses the same margin the PDF renderer does", () => {
    /*
     * page-pdf.ts works in points at 72 to the inch, so its MARGIN of 54 is
     * 0.75in. Matching it means a template authored against these guides has
     * the same column in the API's PDF as in the browser's.
     */
    const margin = /const MARGIN = (\d+);/.exec(PAGE_PDF);
    expect(margin, "page-pdf.ts no longer declares MARGIN").toBeTruthy();
    expect(Number(margin![1]) / 72).toBe(0.75);
  });

  it("prints the page at the size the editor drew it", () => {
    const css = printCss();
    expect(css).toContain("@page { size: Letter; margin: ${PAGE_IN.margin}in; }");
    // One typography block for the editor, the preview and the export.
    expect(MANAGER).toContain("const DOC_TYPOGRAPHY");
    expect(css).toContain("${DOC_TYPOGRAPHY}");
  });

  it("stops the printer slicing a photo, a table or a quote in half", () => {
    /*
     * The cause behind the report. Nothing told the printer which blocks are
     * indivisible, so whatever straddled the boundary got cut - and a guide
     * that predicts a cut through a photo row is not much of an improvement on
     * no guide at all.
     */
    const css = printCss();
    expect(css).toMatch(/table, tr, img, blockquote, li \{ break-inside: avoid/);
    expect(css).toMatch(/p:has\(> img\) \{ break-inside: avoid/);
    expect(css).toMatch(/h1, h2, h3 \{ break-after: avoid/);
    // Tables printed borderless before, which is most of the built-in library.
    expect(css).toMatch(/table \{ border-collapse: collapse/);
  });

  it("draws one guide per boundary and no guide on a one-page template", () => {
    const block = MANAGER.slice(
      MANAGER.indexOf("const paperRef"),
      MANAGER.indexOf("function insertPlaceholder"),
    );
    expect(block.length).toBeGreaterThan(200);
    // Measured off the rendered box, so an image finishing loading counts.
    expect(block).toContain("ResizeObserver");
    expect(block).toMatch(/Math\.ceil\(height \/ PAGE_CONTENT_PX/);
    // `pageCount - 1` boundaries: a single-page template gets none.
    expect(MANAGER).toMatch(/length: pageCount - 1/);
  });
});

/*
 * "the contrast on the form filing on the right side is too little. its hiding
 * alot of text."
 *
 * Every box in the Fields panel shows its sample value as a placeholder until
 * somebody types over it, so the placeholder colour is not an edge case - it is
 * most of the words on that panel. It was gray-400 on a hardcoded white input,
 * 2.6:1, on a panel that follows the theme.
 */
describe("the Fields panel is readable", () => {
  it("uses the app's own Input rather than a hand-rolled light-mode one", () => {
    const panel = MANAGER.slice(
      MANAGER.indexOf("Editable fields"),
      MANAGER.indexOf("All placeholders"),
    );
    expect(panel.length).toBeGreaterThan(200);
    expect(panel).toMatch(/<Input\s/);
    // The colours that made it unreadable, gone rather than merely darkened.
    expect(panel).not.toContain("placeholder:text-gray-400");
    expect(panel).not.toMatch(/className="[^"]*bg-white[^"]*"/);
  });

  it("does not pin a light-mode panel onto a themed dialog", () => {
    const aside = MANAGER.slice(MANAGER.indexOf("<aside"), MANAGER.indexOf("</aside>"));
    expect(aside.length).toBeGreaterThan(200);
    expect(aside).not.toContain("bg-white");
    expect(aside).not.toContain("text-blue-700");
  });
});
