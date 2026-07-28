import Image from "@tiptap/extension-image";

/**
 * Image node that additionally persists `data-photo-id` so the backend can
 * re-resolve a fresh signed URL on every read — the `src` we set at insert
 * time is a signed URL that expires in an hour and must never be trusted
 * as the persisted value.
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
});
