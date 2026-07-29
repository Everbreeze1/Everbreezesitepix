import Image from "@tiptap/extension-image";

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
}).configure({ inline: true, allowBase64: true });

/** True for a template photo slot that has not been filled with a real photo. */
export function isPhotoSlot(attrs: Record<string, unknown>): boolean {
  return !attrs["data-photo-id"] && String(attrs.src ?? "").startsWith("data:image/svg+xml");
}
