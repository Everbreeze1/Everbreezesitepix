import { describe, it, expect, vi, afterEach } from "vitest";

/*
 * The reported bug, in one line: "when I choose a project, it generates a bunch
 * of squiggles and unfriendly info."
 *
 * The squiggles were `{{weather}}`, `{{client_name}}`, `{{prepared_by_title}}`
 * and `{{project_number}}`, printed verbatim into a document created from a
 * template. `resolvePageTokens` recognised eight tokens and left anything else
 * exactly as it found it, while the template library merged twelve. Nothing
 * downstream had a second chance at them: the created page is stored resolved,
 * and the PDF and the public share link render the body without resolving at
 * all - so the customer's copy carried the template's source code.
 *
 * Every assertion below is about that: whatever a template asks for, and
 * whatever the project can or cannot answer, the document that comes out has no
 * curly braces in it.
 */

/**
 * Mutable so a test can put the database into a specific state: a project with
 * client details filled in, or a database where the migration adding those
 * columns has not been applied yet.
 */
const STATE = {
  /** Simulates 20260823000000_project_client_fields.sql not being applied. */
  missingColumns: false,
  project: {
    name: "Buddy",
    street: "9610 Upper Valley Road",
    city: "Auburn",
    state: "CA",
    client_name: null as string | null,
    client_contact: null as string | null,
    project_number: null as string | null,
  },
  profile: {
    full_name: "Mike",
    company: "Everbreeze Heating & Air",
    company_address: "800 Harbor Blvd",
    company_phone: "(555) 123-4567",
    job_title: null as string | null,
  },
};

/**
 * `loadTokenValues` reads one project row and one profile row through the admin
 * client, both `.select(...).eq(...).maybeSingle()`. The select list is
 * inspected so the mock can answer 42703 for the columns the migration adds,
 * which is what a live database says before that SQL has been run.
 */
vi.mock("../apps/api/src/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            const wantsNewColumns = /client_name|job_title/.test(columns ?? "");
            if (wantsNewColumns && STATE.missingColumns) {
              return {
                data: null,
                error: { code: "42703", message: "column projects.client_name does not exist" },
              };
            }
            return { data: table === "projects" ? STATE.project : STATE.profile };
          },
        }),
      }),
    }),
  }),
}));

const {
  resolvePageTokens,
  tokensToPills,
  bracketsToFillFields,
  fieldLabel,
  isMissingColumn,
  SUPPORTED_TOKENS,
} = await import("../apps/api/src/domains/projects/pages");
const { valuesToTokens, blankFillFields } =
  await import("../apps/api/src/domains/projects/page-templates");

/** The pipeline `createPageFromTemplateService` runs a template body through. */
async function asCreated(html: string, values: Record<string, string> = {}): Promise<string> {
  const resolved = (await resolvePageTokens(html, "p1", "u1", values)) ?? html;
  return bracketsToFillFields(resolved) ?? resolved;
}

/** The header of the walkthrough log the client had open in the screenshot. */
const WALKTHROUGH = `<h1>{{project_name}} - Walkthrough Log</h1>
<p><strong>Date:</strong> {{date}} - <strong>Weather:</strong> {{weather}}</p>
<p><strong>Led by:</strong> {{prepared_by}}, {{prepared_by_title}} - <strong>Client:</strong> {{client_name}}</p>
<p><strong>Location:</strong> {{project_address}} - <strong>Project #:</strong> {{project_number}}</p>`;

describe("creating a document from a template", () => {
  it("leaves no {{token}} anywhere in the document", async () => {
    const created = await asCreated(WALKTHROUGH);
    expect(created).not.toContain("{{");
    expect(created).not.toContain("}}");
  });

  it("merges in what the project knows", async () => {
    const created = await asCreated(WALKTHROUGH);
    expect(created).toContain("Buddy");
    expect(created).toContain("9610 Upper Valley Road, Auburn, CA");
    expect(created).toContain("Mike");
  });

  it("turns what it cannot know into a click-to-type blank, not template source", async () => {
    const created = await asCreated(WALKTHROUGH);
    // Four fields no table holds. Each arrives as an empty field carrying its
    // human label, which the editor renders as a box you click and type into.
    for (const label of ["Weather", "Client name", "Job title", "Project number"]) {
      expect(created, `${label} did not become a blank`).toContain(`data-label="${label}"></span>`);
    }
  });

  it("uses the values typed in the Use-in-a-project step", async () => {
    const created = await asCreated(WALKTHROUGH, {
      weather: "Clear, 68F",
      client_name: "Sarah Whitfield",
      project_number: "PRJ-00421",
    });
    expect(created).toContain("Clear, 68F");
    expect(created).toContain("Sarah Whitfield");
    expect(created).toContain("PRJ-00421");
    // Untyped ones still fall back to a blank rather than to source.
    expect(created).toContain('data-label="Job title"></span>');
    expect(created).not.toContain("{{");
  });

  it("degrades a token nobody has ever defined instead of printing it", async () => {
    const created = await asCreated("<p>Site: {{jobsite_addr}}</p>");
    expect(created).not.toContain("{{");
    expect(created).toContain('data-label="Jobsite addr"');
  });

  it("escapes merged values instead of splicing them into the markup", async () => {
    // PROFILE.company is `Everbreeze Heating & Air`. Interpolated raw, a company
    // called `A <b>B</b>` would rewrite the document around it.
    const created = await asCreated("<p>{{company_name}}</p>");
    expect(created).toContain("Everbreeze Heating &amp; Air");
  });

  it("keeps a blank empty so the ghost label never becomes document text", async () => {
    // `data-label` is drawn by CSS `content: attr(data-label)`, deliberately
    // outside the text layer - it must not be exportable or copyable.
    const created = await asCreated("<p>Weather: {{weather}}</p>");
    expect(created).toMatch(/<span data-fill-field data-label="Weather"><\/span>/);
  });
});

describe("reopening a document written before the resolver knew these fields", () => {
  it("repairs a stored {{weather}} into a blank rather than showing it", async () => {
    // The client's existing document holds the literal token. Opening it in the
    // editor has to offer something typeable, not a pill with nothing behind it.
    const forEditor = await tokensToPills("<p>Weather: {{weather}}</p>", "p1", "u1");
    expect(forEditor).not.toContain("{{");
    expect(forEditor).toContain('data-fill-field data-label="Weather"');
  });

  it("still shows a merge field with a data source as a live pill", async () => {
    // These stay merges: filling the company in under Settings has to update
    // every document at once, which a one-off typed blank would not do.
    const forEditor = await tokensToPills("<p>{{company_name}}</p>", "p1", "u1");
    expect(forEditor).toContain('data-token="company_name"');
  });

  it("marks a merge field with nothing behind it as empty, not as source", async () => {
    const forEditor = await tokensToPills("<p>{{company_address}}</p>", "p1", "u1");
    expect(forEditor).toContain('data-token="company_address"');
    expect(forEditor).not.toContain("{{");
  });
});

describe("the client and job fields, once the project holds them", () => {
  afterEach(() => {
    STATE.missingColumns = false;
    STATE.project.client_name = null;
    STATE.project.client_contact = null;
    STATE.project.project_number = null;
    STATE.profile.job_title = null;
  });

  it("merges them in instead of asking for them again", async () => {
    /*
     * The point of the migration: these four used to have nowhere to live, so
     * every document created for the same job asked for all of them again.
     */
    STATE.project.client_name = "Sarah Whitfield";
    STATE.project.project_number = "PRJ-00421";
    STATE.profile.job_title = "Project Manager";

    const created = await asCreated(WALKTHROUGH);
    expect(created).toContain("Sarah Whitfield");
    expect(created).toContain("PRJ-00421");
    expect(created).toContain("Project Manager");
    expect(created).not.toContain("{{");
    // Nothing left to fill in but the weather, which is genuinely per-visit.
    expect(created).toContain('data-label="Weather"></span>');
    expect(created).not.toContain('data-label="Client name"></span>');
  });

  it("still lets the Use-in-a-project step override the stored value", async () => {
    // The stored client is the usual answer, not the only one - a document can
    // be addressed to somebody else without editing the project.
    STATE.project.client_name = "Sarah Whitfield";
    const created = await asCreated(WALKTHROUGH, { client_name: "Someone Else" });
    expect(created).toContain("Someone Else");
    expect(created).not.toContain("Sarah Whitfield");
  });

  it("keeps working when the migration has not been applied yet", async () => {
    /*
     * This is the one that matters for shipping order. Migrations here are run
     * by hand, so the code lands before the SQL does. Selecting a column that
     * does not exist makes PostgREST answer 42703 and the call throw, which
     * would take document creation down entirely until someone ran it.
     */
    STATE.missingColumns = true;
    const created = await asCreated(WALKTHROUGH);
    expect(created).not.toContain("{{");
    // The fields that always existed still merge...
    expect(created).toContain("Buddy");
    expect(created).toContain("Mike");
    // ...and the new ones degrade to the blank they were before the migration.
    expect(created).toContain('data-label="Client name"></span>');
    expect(created).toContain('data-label="Project number"></span>');
  });

  it("does not swallow a real database error", async () => {
    // Only 42703 is a missing migration. Anything else is a fault and has to
    // keep propagating rather than being quietly treated as "no value".
    expect(isMissingColumn({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingColumn({ code: "42703" })).toBe(true);
    expect(isMissingColumn(null)).toBe(false);
  });
});

describe("saving a finished document as a template", () => {
  const SOURCE = {
    project_name: "Meghan",
    project_address: "2229 Zittel Drive, Folsom, CA",
    company_name: "Everbreeze Heating & Air",
    prepared_by: "Mike",
  };

  it("hands the next project its own details, not the last one's", () => {
    /*
     * The report this stands in for was generated for a real job and held no
     * token at all, so saving it produced a "template" that opened with the
     * previous customer's name and site address on every future project.
     */
    const page =
      "<h1>Meghan</h1><p>2229 Zittel Drive, Folsom, CA</p><p>Prepared by Mike, Everbreeze Heating &amp; Air</p>";
    const template = valuesToTokens(page, SOURCE);
    expect(template).not.toContain("Meghan");
    expect(template).not.toContain("Zittel");
    expect(template).toContain("{{project_name}}");
    expect(template).toContain("{{project_address}}");
    expect(template).toContain("{{prepared_by}}");
    // The company was merged in escaped (`Heating &amp; Air`), so matching only
    // the raw string would have left that one name behind in every template.
    expect(template).toContain("{{company_name}}");
  });

  it("matches the address whole rather than the city inside it", () => {
    const template = valuesToTokens("<p>2229 Zittel Drive, Folsom, CA</p>", {
      ...SOURCE,
      project_name: "Folsom",
    });
    expect(template).toBe("<p>{{project_address}}</p>");
  });

  it("leaves ordinary prose that merely contains a value alone", () => {
    const template = valuesToTokens("<p>Mikey checked the Meghans room</p>", SOURCE);
    expect(template).toBe("<p>Mikey checked the Meghans room</p>");
  });

  it("does not rewrite attribute values", () => {
    const html = '<img src="https://cdn.example.com/Meghan.jpg" alt="Meghan site">';
    expect(valuesToTokens(html, SOURCE)).toBe(html);
  });

  it("ignores a value too short to be distinctive", () => {
    const html = "<p>The CA inspector signed off</p>";
    expect(valuesToTokens(html, { project_name: "CA" })).toBe(html);
  });

  it("empties the blanks the last job typed into, keeping their labels", () => {
    const page = '<p><span data-fill-field data-label="Client name">Sarah Whitfield</span></p>';
    expect(blankFillFields(page)).toBe(
      '<p><span data-fill-field data-label="Client name"></span></p>',
    );
  });
});

describe("field labels", () => {
  it("names every supported field in words a customer could read", () => {
    for (const token of SUPPORTED_TOKENS) {
      const label = fieldLabel(token);
      expect(label, `${token} has no label`).toBeTruthy();
      expect(label, `${token} leaks its token name`).not.toContain("_");
    }
  });

  it("falls back to a readable guess for anything else", () => {
    expect(fieldLabel("prepared_by_notes")).toBe("Prepared by notes");
  });
});
