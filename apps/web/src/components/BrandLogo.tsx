import { BrandMark } from "@/components/BrandMark";

/**
 * The app icon treatment of the mark: the aperture on its own rounded dark
 * tile, so it reads the same on the marketing hero, the sidebar and a white
 * settings page without each caller having to supply a ground for it.
 *
 * The tile is the artwork from the design file, not a container the mark
 * happens to sit in: 22% corner radius and a radial ground lit from the upper
 * left, matching what ships as the iOS and Android icon.
 */

/**
 * Mark width as a fraction of the tile.
 *
 * From the design file's own icon sheet: a 70px mark in a 96px tile. The mark
 * only inks the middle two thirds of its viewBox, so the gold ends up at about
 * 49% of the tile. Sizing the mark to the full tile instead makes the disc
 * crowd the corners and the rounded square stops reading as a tile at all.
 */
const MARK_RATIO = 0.73;

interface BrandLogoProps {
  size?: number;
  className?: string;
}

export function BrandLogo({ size = 36, className }: BrandLogoProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[22%] ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 35% 30%, #262A44, #0A0A10)",
      }}
      /* `role` is load-bearing: an `aria-label` on a bare span is ignored by
         several screen readers, so without it the mark announced as nothing. */
      role="img"
      aria-label="Everlumen"
    >
      <BrandMark size={Math.round(size * MARK_RATIO)} />
    </span>
  );
}
