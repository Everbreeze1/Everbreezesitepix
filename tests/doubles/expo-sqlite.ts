import type { DatabaseSync } from "node:sqlite";

/**
 * Stands in for `expo-sqlite` under vitest.
 *
 * The native module cannot load in Node, but the SQL the app runs is worth
 * testing for real, so this adapts Node's built-in `node:sqlite` to the handful
 * of `expo-sqlite` methods the offline layer uses. Tests supply the database
 * with `__useDatabase`, which lets each one start from an empty `:memory:`
 * instance.
 *
 * Wired in by a `resolve.alias` entry in `vitest.config.ts`, because a bare
 * `vi.mock("expo-sqlite")` in `tests/` cannot resolve a package that is only
 * installed under `apps/mobile`.
 */

let current: DatabaseSync | null = null;

export function __useDatabase(db: DatabaseSync): void {
  current = db;
}

function requireDb(): DatabaseSync {
  if (!current) throw new Error("expo-sqlite double: call __useDatabase(db) first");
  return current;
}

export async function openDatabaseAsync() {
  const db = requireDb();
  return {
    execAsync: async (source: string) => {
      db.exec(source);
    },
    runAsync: async (source: string, params: unknown[] = []) => {
      const result = db.prepare(source).run(...(params as never[]));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    getFirstAsync: async (source: string, params: unknown[] = []) =>
      db.prepare(source).get(...(params as never[])) ?? null,
    getAllAsync: async (source: string, params: unknown[] = []) =>
      db.prepare(source).all(...(params as never[])),
  };
}
