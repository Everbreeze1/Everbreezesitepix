import * as SQLite from "expo-sqlite";

/**
 * Local durable store for the offline outbox.
 *
 * SQLite rather than AsyncStorage because an outbox is not key-value work. It
 * needs ordering, per-project selection, attempt counters, and an atomic claim
 * so one drain pass cannot pick up a row another pass is already sending. Doing
 * that over a JSON blob means read-modify-write on the whole queue for every
 * state change, which loses rows the moment two writes overlap.
 */

const DB_NAME = "everlumen-offline.db";

let handle: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Schema, applied once per version.
 *
 * `user_version` is SQLite's own counter, so migrations do not need a table of
 * their own. Add a numbered block below and raise `SCHEMA_VERSION`; never edit
 * a block that has already shipped, because installs in the field have already
 * run it.
 */
const SCHEMA_VERSION = 1;

async function migrate(db: SQLite.SQLiteDatabase) {
  // WAL keeps a reader from blocking the drain's writes. `NORMAL` sync is the
  // usual pairing: durable across process death, which is what matters here,
  // without an fsync per statement.
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA synchronous = NORMAL;");

  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version;");
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  if (current < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS outbox (
        id            TEXT PRIMARY KEY NOT NULL,
        kind          TEXT NOT NULL,
        project_id    TEXT,
        payload       TEXT NOT NULL,
        local_uri     TEXT,
        state         TEXT NOT NULL DEFAULT 'pending',
        attempts      INTEGER NOT NULL DEFAULT 0,
        next_attempt  INTEGER NOT NULL DEFAULT 0,
        last_error    TEXT,
        created_at    INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS outbox_drain_idx
        ON outbox (state, next_attempt, created_at);

      CREATE INDEX IF NOT EXISTS outbox_project_idx
        ON outbox (project_id, state, created_at);
    `);
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

/**
 * The shared connection.
 *
 * Cached as the in-flight promise, not the resolved database, so that two
 * callers racing at startup await the same open rather than opening twice and
 * running the migration concurrently.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!handle) {
    handle = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrate(db);
      return db;
    })().catch((error) => {
      // Let the next caller retry instead of caching a rejected promise
      // forever, which would leave the app permanently unable to queue.
      handle = null;
      throw error;
    });
  }
  return handle;
}
