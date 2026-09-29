import { cleanCaption } from "@everlumen/shared";

/**
 * The caption line under a photo, wherever a project's photos are shown.
 *
 * A photo's caption is its note: typed, or spoken through the camera's voice
 * note. Jon wants it read under the photo, as a caption is, rather than only
 * inside the viewer's details. So grid and calendar tiles carry it as a short
 * line under the picture, and the viewer carries it in full under the photo,
 * where a tap opens the note editor to change it.
 */

/** The caption to show, or null when there is none worth showing (a file name, blanks). */
export function captionText(caption: string | null | undefined): string | null {
  return cleanCaption(caption);
}

/**
 * How many lines a tile's caption gets: two on a tile wide enough to read
 * two, one on the smallest tiles, where a second line is mostly ellipsis.
 */
export function tileCaptionLines(tileWidth: number): 1 | 2 {
  return tileWidth >= 110 ? 2 : 1;
}

/** Point size of a tile's caption, and the room its lines take under the tile. */
export const TILE_CAPTION_SIZE = 12;
export const TILE_CAPTION_LINE = 16;

/**
 * The room a caption takes under a tile, so a grid row can be sized for it.
 * Zero when the photo has no caption: an uncaptioned grid stays as tight as
 * it was.
 */
export function tileCaptionHeight(caption: string | null | undefined, tileWidth: number): number {
  if (!captionText(caption)) return 0;
  return 4 + tileCaptionLines(tileWidth) * TILE_CAPTION_LINE;
}

/** The placeholder under an uncaptioned photo in the viewer, which opens the editor. */
export const ADD_CAPTION_LABEL = "Add a caption or voice note";
