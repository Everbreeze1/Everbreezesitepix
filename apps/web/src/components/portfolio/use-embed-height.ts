import { useEffect } from "react";

/** Namespaced so a host page running other widgets can ignore our messages. */
export const EMBED_MESSAGE_TYPE = "sitepix:embed:height";

/**
 * Reports this document's height to the parent window so the host page's iframe
 * can grow with the content.
 *
 * An iframe cannot size itself and the parent cannot measure across origins, so
 * postMessage is the only route. `embed.js` on the host side listens for
 * EMBED_MESSAGE_TYPE and sets the height.
 *
 * A ResizeObserver covers the cases a load event misses: images arriving, a
 * filter chip changing the row count, and the host page's own column width
 * changing on rotate.
 */
export function useEmbedHeight(): void {
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;

    let last = 0;
    const post = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      // Sub-pixel churn would otherwise fire a message on every scroll frame.
      if (Math.abs(height - last) < 2) return;
      last = height;
      // "*" because the embed is deliberately host-agnostic — it has to work on
      // whatever domain the contractor pastes it into. Only a height is sent.
      window.parent.postMessage({ type: EMBED_MESSAGE_TYPE, height }, "*");
    };

    post();
    const observer = new ResizeObserver(post);
    observer.observe(document.documentElement);
    window.addEventListener("load", post);
    const interval = window.setInterval(post, 1000);

    return () => {
      observer.disconnect();
      window.removeEventListener("load", post);
      window.clearInterval(interval);
    };
  }, []);
}
