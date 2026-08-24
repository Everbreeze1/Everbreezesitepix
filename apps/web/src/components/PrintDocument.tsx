import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const ROOT_ID = "everlumen-print-root";
const BODY_CLASS = "has-print-document";

/**
 * Renders its children into a body-level print surface that is the *only* thing
 * on the page when the sheet goes to the printer.
 *
 * Screen-printing an app page directly does not work here. The record lives
 * inside the app shell - sidebar, sticky 82px header, mobile tab bar, toasts,
 * Radix portals - and every one of those is a direct child of `<body>` or a
 * `position: fixed` layer, so they land on the paper too. Reaching for
 * `print:hidden` on each of them means every future piece of chrome has to
 * remember to opt out.
 *
 * So the rule is inverted, in `styles.css`: while a page has a print document
 * mounted, print hides every body child *except* this one. The interactive view
 * stays tuned for filling a checklist in on a phone; the paper gets a clean
 * letterhead document. And because the class is applied on mount rather than by
 * a button, the browser's own Ctrl+P produces exactly the same sheet as the
 * app's Print action.
 */
export function PrintDocument({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let node = document.getElementById(ROOT_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = ROOT_ID;
      document.body.appendChild(node);
    }
    setHost(node);
    document.body.classList.add(BODY_CLASS);
    return () => {
      // The node is left in place - it is empty and display:none off-print, and
      // reusing it avoids a remove/append churn every time a record is opened.
      document.body.classList.remove(BODY_CLASS);
    };
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}
