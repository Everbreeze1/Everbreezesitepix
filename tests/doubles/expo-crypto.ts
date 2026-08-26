/**
 * Stands in for `expo-crypto` under vitest.
 *
 * Ids are sequential rather than random so a failing test names the same row
 * every run. Wired in by `resolve.alias` in `vitest.config.ts`; see
 * `./expo-sqlite` for why an alias rather than `vi.mock`.
 */

let counter = 0;

export function __resetIds(): void {
  counter = 0;
}

export function randomUUID(): string {
  counter += 1;
  return `uuid-${counter}`;
}
