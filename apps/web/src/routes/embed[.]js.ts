import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

/**
 * The one file a contractor pastes into their own website.
 *
 * CompanyCam's pitch for the website gallery and map is "copy a snippet, paste
 * it, done - no coding". That only holds if the snippet is a single tag that
 * needs no configuration and no follow-up CSS, so this script:
 *
 *   * finds its own <script> tag and builds the iframe next to it,
 *   * carries every data-* attribute through as a query param,
 *   * listens for the height messages the embed posts and resizes to fit.
 *
 * Served as a route handler rather than a file in public/ so the widget origin
 * is derived from the request instead of hardcoded - that keeps preview
 * deployments working, and means a self-hosted install needs no edit.
 *
 * Deliberately ES5-ish and dependency-free: this runs on whatever the host
 * site is built with, including page builders that still ship ES5 bundles.
 */
const SCRIPT = String.raw`(function () {
  "use strict";
  var MESSAGE_TYPE = "sitepix:embed:height";

  // document.currentScript is null inside async/deferred execution on some page
  // builders, so fall back to the last script tag that looks like ours.
  function findSelf() {
    if (document.currentScript) return document.currentScript;
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if ((all[i].src || "").indexOf("/embed.js") !== -1) return all[i];
    }
    return null;
  }

  var self = findSelf();
  if (!self) return;
  // Guard against the snippet being pasted twice (common in page builders that
  // duplicate blocks) - without it the visitor sees two galleries.
  if (self.getAttribute("data-sitepix-done") === "1") return;
  self.setAttribute("data-sitepix-done", "1");

  var origin = new URL(self.src, window.location.href).origin;
  var kind = self.getAttribute("data-sitepix") || "gallery";
  var key = self.getAttribute("data-key");
  if (!key) {
    console.warn("[sitepix] embed is missing data-key");
    return;
  }

  var params = [];
  function pass(attr, param) {
    var value = self.getAttribute(attr);
    if (value) params.push(param + "=" + encodeURIComponent(value));
  }
  pass("data-columns", "columns");
  pass("data-filters", "filters");
  pass("data-limit", "limit");
  pass("data-pin", "pin");
  pass("data-height", "height");

  var src =
    origin +
    "/embed/" +
    (kind === "map" ? "map" : "gallery") +
    "/" +
    encodeURIComponent(key) +
    (params.length ? "?" + params.join("&") : "");

  var frame = document.createElement("iframe");
  frame.src = src;
  frame.title = kind === "map" ? "Project map" : "Project gallery";
  frame.loading = "lazy";
  frame.setAttribute("frameborder", "0");
  frame.setAttribute("scrolling", "no");
  frame.setAttribute("allowtransparency", "true");
  frame.style.width = "100%";
  frame.style.border = "0";
  frame.style.display = "block";
  frame.style.overflow = "hidden";
  // A map has no content height to grow into, so it takes the requested height
  // up front; the gallery starts short and is corrected by the first message.
  frame.style.height =
    kind === "map" ? (self.getAttribute("data-height") || "460") + "px" : "600px";

  self.parentNode.insertBefore(frame, self.nextSibling);

  if (kind === "map") return;

  window.addEventListener("message", function (event) {
    // The height is the only field trusted, and only from our own iframe -
    // any other frame on the host page posting this shape is ignored.
    if (event.origin !== origin) return;
    if (!event.data || event.data.type !== MESSAGE_TYPE) return;
    if (frame.contentWindow !== event.source) return;
    var height = parseInt(event.data.height, 10);
    if (!isFinite(height) || height < 80 || height > 20000) return;
    frame.style.height = height + "px";
  });
})();
`;

export const Route = createFileRoute("/embed.js")({
  server: {
    handlers: {
      GET: async () =>
        new Response(SCRIPT, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            // Long cache with a short revalidation window: hundreds of third
            // party sites will hotlink this, and a fix must still reach them.
            "Cache-Control": "public, max-age=600, stale-while-revalidate=86400",
            "Access-Control-Allow-Origin": "*",
          },
        }),
    },
  },
});
