/**
 * Console breadcrumbs that only exist in development.
 *
 * The walkthrough capture/upload pipeline is diagnosed almost entirely through
 * its `console.log` trail, so the calls are worth keeping - but they carry user
 * ids, project ids, storage paths and media metadata, none of which belongs in
 * a customer's browser console. Vite statically replaces `import.meta.env.DEV`,
 * so these calls are dropped from the production bundle by dead-code
 * elimination rather than merely being silenced at runtime.
 *
 * Genuine failures stay on `console.warn` / `console.error` - those are error
 * reporting, not breadcrumbs, and must survive in production.
 */
export function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log(...args);
}
