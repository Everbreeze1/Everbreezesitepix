import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { friendlyError, isPendingMigrationError } from "../apps/web/src/lib/supabase-errors";
import { isMissingColumn } from "../apps/web/src/lib/merge-field-columns";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Migrations in this project are applied by hand, so there is always a window
 * where the code selects a table or column the database has not got yet. Two
 * screens key their whole rendering off `isPendingMigrationError`: get it wrong
 * and a panel shows "you may be offline. Nothing has been lost - try again once
 * you have a connection", with a retry button that can never succeed and no
 * mention of the one thing that would fix it.
 *
 * The trap is that there are two error families for the same situation, and only
 * one of them says "does not exist".
 */

describe("is the database behind the code", () => {
  it("recognises what Postgres raises directly", () => {
    // Older PostgREST passes these through with the SQLSTATE intact.
    expect(isPendingMigrationError({ code: "42703", message: 'column "x" does not exist' })).toBe(
      true,
    );
    expect(
      isPendingMigrationError({ code: "42P01", message: 'relation "public.x" does not exist' }),
    ).toBe(true);
  });

  it("recognises what current PostgREST answers from its schema cache", () => {
    /*
     * The regression this test exists for. PostgREST 12 never reaches Postgres for
     * an unknown name, so there is no SQLSTATE and no "does not exist" - and a
     * missing table is exactly the case the hand-applied migration workflow
     * produces most often.
     */
    expect(
      isPendingMigrationError({
        code: "PGRST205",
        message: "Could not find the table 'public.task_photo_items' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isPendingMigrationError({
        code: "PGRST204",
        message: "Could not find the 'photo_ids' column of 'tasks' in the schema cache",
      }),
    ).toBe(true);
  });

  it("still works on the message alone when no code came through", () => {
    expect(isPendingMigrationError({ message: 'relation "public.x" does not exist' })).toBe(true);
    expect(
      isPendingMigrationError({
        message: "Could not find the table 'public.x' in the schema cache",
      }),
    ).toBe(true);
  });

  it("does not claim a real failure is a missing migration", () => {
    // Otherwise every dropped connection sends the user to the SQL editor.
    expect(isPendingMigrationError({ message: "Failed to fetch" })).toBe(false);
    expect(
      isPendingMigrationError({
        code: "42501",
        message: 'new row violates row-level security policy for table "photos"',
      }),
    ).toBe(false);
    expect(isPendingMigrationError(null)).toBe(false);
    expect(isPendingMigrationError(undefined)).toBe(false);
    expect(isPendingMigrationError(new Error("boom"))).toBe(false);
  });
});

describe("the three copies of 'that column is not there yet' agree", () => {
  /*
   * There are three, in three packages that cannot import from each other, and
   * they drifted: apps/api/src/lib/postgrest.ts had learned that PostgREST answers
   * from its schema cache and the two others had not. The web one guards WRITES,
   * which is exactly where the schema-cache code is the only one that fires, so it
   * was the one that mattered and the one that was wrong.
   */
  const sources = {
    "apps/api/src/lib/postgrest.ts": read("apps/api/src/lib/postgrest.ts"),
    "apps/web/src/lib/merge-field-columns.ts": read("apps/web/src/lib/merge-field-columns.ts"),
  };

  it("all of them know both error families", () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).toContain("PGRST204");
      expect(source, name).toContain("42703");
    }
  });

  it("has one spelling per package, not one per file", () => {
    // pages.ts grew its own narrower copy; it now re-exports the canonical one.
    const pages = read("apps/api/src/domains/projects/pages.ts");
    expect(pages).toContain('from "../../lib/postgrest"');
    expect(pages).not.toMatch(/export function isMissingColumn/);
  });

  it("the missing-table check knows both families too", () => {
    const postgrest = sources["apps/api/src/lib/postgrest.ts"];
    expect(postgrest).toContain("PGRST205");
    expect(postgrest).toContain("42P01");
  });

  it("fires on the write rejection that stopped the retry from ever running", () => {
    expect(
      isMissingColumn({
        code: "PGRST204",
        message: "Could not find the 'client_name' column of 'projects' in the schema cache",
      }),
    ).toBe(true);
    expect(isMissingColumn({ code: "42703", message: 'column "client_name" does not exist' })).toBe(
      true,
    );
  });

  it("does not retry a write that failed for a real reason", () => {
    // Retrying without the columns would silently drop what the user typed.
    expect(
      isMissingColumn({ code: "42501", message: "permission denied for table projects" }),
    ).toBe(false);
    expect(isMissingColumn({ message: "Failed to fetch" })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
    expect(isMissingColumn("nope")).toBe(false);
  });
});

describe("what a crew member reads when a write is refused", () => {
  it("translates the refusals that would otherwise arrive as driver text", () => {
    expect(
      friendlyError(
        { message: 'new row violates row-level security policy for table "photos"' },
        "fallback",
      ),
    ).toBe("You don't have permission to do that on this project");
    expect(friendlyError({ message: "duplicate key value violates unique constraint" }, "f")).toBe(
      "That already exists",
    );
    expect(friendlyError({ message: "insert violates foreign key constraint" }, "f")).toContain(
      "was removed",
    );
    expect(friendlyError({ message: "Failed to fetch" }, "f")).toContain("No connection");
  });

  it("falls back rather than inventing a diagnosis", () => {
    // Fail-safe by construction: the caller's fallback is a sentence written for
    // that screen, so an unrecognised error is never raw driver text.
    expect(friendlyError({ message: "something nobody has seen before" }, "Could not save")).toBe(
      "Could not save",
    );
    expect(friendlyError(null, "Could not save")).toBe("Could not save");
  });

  it("never returns a constraint name or a table name", () => {
    const messages = [
      'new row violates row-level security policy for table "photos"',
      'duplicate key value violates unique constraint "photos_pkey"',
      'insert or update on table "tasks" violates foreign key constraint "tasks_project_id_fkey"',
    ];
    for (const message of messages) {
      const shown = friendlyError({ message }, "Could not save");
      expect(shown).not.toContain("constraint");
      expect(shown).not.toContain("violates");
      expect(shown).not.toContain('"');
    }
  });
});
