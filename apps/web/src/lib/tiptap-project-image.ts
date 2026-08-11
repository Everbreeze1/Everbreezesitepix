import Image from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * A bare HTML width/height attribute value ("48%", "280") is a valid
 * *attribute*, but as a CSS length "280" is invalid and gets silently
 * dropped — it needs an explicit unit ("280px").
 */
function cssLength(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return /^[\d.]+$/.test(s) ? `${s}px` : s;
}

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
  // paint generated content on replaced elements), so every image is wrapped
  // in a span. Only a real inserted photo — anything with data-photo-id —
  // gets the "Change photo" overlay inside that wrapper; an empty template
  // slot has its own click-to-add art and takes the wrapper without one.
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

        // A percentage width (e.g. a 2-up photo row template ships "48%" so
        // the pair fills the paragraph's width) can only resolve against a
        // containing block with a definite width. The wrapper span this
        // NodeView adds is `display: inline-block` with no width of its own,
        // so leaving the percentage on the <img> makes it resolve against
        // nothing — the browser falls back to the photo's native pixel size,
        // which is how a real upload was blowing up to its own huge intrinsic
        // size while a neighboring empty slot (a small SVG) stayed put and
        // wrapped to the next line. Put the real box size on the wrapper
        // instead, and have the <img> just fill it.
        const w = cssLength(n.attrs.width);
        const h = cssLength(n.attrs.height);
        if (n.attrs.width != null) img.setAttribute("width", String(n.attrs.width));
        else img.removeAttribute("width");
        if (n.attrs.height != null) img.setAttribute("height", String(n.attrs.height));
        else img.removeAttribute("height");
        wrapper.style.width = w ?? "";
        wrapper.style.height = h ?? "";
        if (w && h) {
          img.style.width = "100%";
          img.style.height = "100%";
          img.style.objectFit = "cover";
        } else {
          img.style.width = "";
          img.style.height = "";
          img.style.objectFit = "";
        }

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
