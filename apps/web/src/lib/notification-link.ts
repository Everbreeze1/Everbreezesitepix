/**
 * Where a notification's `link_path` should send the reader.
 *
 * The two places that open a notification called `navigate({ to: n.linkPath })`
 * with the stored string whole. That works for the bare paths the triggers used
 * to write, and stops working the moment one of them carries a query string:
 * TanStack Router treats `to` as a pathname, so "/projects/x?photo=y" resolves
 * as a route literally named "x?photo=y" rather than as project x with a search
 * param. Splitting here is what lets a notification point at a specific photo
 * instead of at the project it lives on.
 *
 * Anything without a "?" comes back untouched, so every existing notification
 * behaves exactly as it did.
 */
export interface NotificationLinkTarget {
  to: string;
  search?: Record<string, string>;
}

export function notificationLinkTarget(linkPath: string): NotificationLinkTarget {
  const cut = linkPath.indexOf("?");
  if (cut === -1) return { to: linkPath };

  const to = linkPath.slice(0, cut);
  const params = new URLSearchParams(linkPath.slice(cut + 1));
  const search: Record<string, string> = {};
  for (const [k, v] of params) search[k] = v;

  // A trailing "?" with nothing after it is a path, not a search.
  return Object.keys(search).length ? { to, search } : { to };
}
