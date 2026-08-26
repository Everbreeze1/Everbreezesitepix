/**
 * Stands in for `expo-secure-store` under vitest.
 *
 * An in-memory Keychain. Tests can inspect what was written, which is the point:
 * the chunking in `src/lib/secure-storage.ts` is only correct if the pieces on
 * disk reassemble to exactly what went in.
 */

const store = new Map<string, string>();

export function __reset(): void {
  store.clear();
}

export function __dump(): Map<string, string> {
  return new Map(store);
}

/** Android refuses values past roughly this size. Set to simulate that. */
let maxValueBytes = Infinity;

export function __setMaxValueBytes(limit: number): void {
  maxValueBytes = limit;
}

export async function getItemAsync(key: string): Promise<string | null> {
  return store.has(key) ? (store.get(key) as string) : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (new TextEncoder().encode(value).length > maxValueBytes) {
    throw new Error("Value is too large for SecureStore");
  }
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}
