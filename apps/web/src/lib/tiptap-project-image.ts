import Image from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * Image node that additionally persists `data-photo-id` so the backend can
 * re-resolve a fresh signed URL on every read — the `src` we set at insert
 * time is a signed URL that expires in an hour and must never be trusted
 * as the persisted value.
 *
 * `inline` lets several images share a paragraph, which is how template photo
 * strips lay out side by side. `allowBase64` is required for the inline SVG
 * "click to add" photo slots that templates ship with — Tiptap otherwise
 * drops any `src` starting with `data:` while parsing.
 */
export const ProjectImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-photo-id": {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-photo-id"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs["data-photo-id"] ? { "data-photo-id": attrs["data-photo-id"] } : {},
      },
    };
  },

  // A plain `renderHTML` <img> can't host a hover overlay (browsers don't
  // paint generated content on replaced elements), so a real inserted photo
  // — anything with data-photo-id — gets wrapped in a span with a "Change
  // photo" overlay that CSS reveals on hover. An empty template slot skips
  // the wrapper: it already has its own click-to-add affordance.
  addNodeView() {
    if (typeof document === "undefined") return null;

    return ({ node }: { node: ProseMirrorNode }) => {
      const wrapper = document.createElement("span");
      wrapper.className = "tiptap-photo";

      // ProseMirror sets `draggable` on the NodeView's own dom (the wrapper)
      // for reordering — leave the inner <img> non-draggable so it doesn't
      // additionally trigger the browser's native "drag image out" behavior.
      const img = document.createElement("img");
      img.draggable = false;
      wrapper.appendChild(img);

      let overlay: HTMLSpanElement | null = null;

      const sync = (n: ProseMirrorNode) => {
        if (n.attrs.src) img.setAttribute("src", n.attrs.src as string);
        else img.removeAttribute("src");
        if (n.attrs.alt) img.setAttribute("alt", n.attrs.alt as string);
        else img.removeAttribute("alt");
        if (n.attrs.width != null) img.setAttribute("width", String(n.attrs.width));
        else img.removeAttribute("width");
        if (n.attrs.height != null) img.setAttribute("height", String(n.attrs.height));
        else img.removeAttribute("height");

        const photoId = n.attrs["data-photo-id"];
        if (photoId) img.setAttribute("data-photo-id", String(photoId));
        else img.removeAttribute("data-photo-id");

        if (photoId && !overlay) {
          overlay = document.createElement("span");
          overlay.className = "tiptap-photo-overlay";
          overlay.textContent = "Change photo";
          wrapper.appendChild(overlay);
        } else if (!photoId && overlay) {
          wrapper.removeChild(overlay);
          overlay = null;
        }
      };

      sync(node);

      return {
        dom: wrapper,
        update: (updatedNode: ProseMirrorNode) => {
          if (updatedNode.type !== node.type) return false;
          sync(updatedNode);
          return true;
        },
      };
    };
  },
}).configure({ inline: true, allowBase64: true });

/** True for a template photo slot that has not been filled with a real photo. */
export function isPhotoSlot(attrs: Record<string, unknown>): boolean {
  return !attrs["data-photo-id"] && String(attrs.src ?? "").startsWith("data:image/svg+xml");
}
