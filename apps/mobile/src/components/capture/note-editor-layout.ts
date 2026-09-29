/**
 * The photo note editor's layout rules, kept pure so they can be tested
 * without a phone.
 *
 * Jon's report (2026-09-29): the camera's small note window was right, but
 * the mic brought up the Android keyboard and the keyboard covered the whole
 * window. So the editor has two shapes. At rest it shows the photo, its
 * Before/None/After, the note, its tags and the "Add voice note" action.
 * While the keyboard is up it folds into one bar that sits directly on top of
 * the keyboard: the photo small, the note being typed or dictated, and Done.
 */

/**
 * How much of a view the on-screen keyboard covers, in points.
 *
 * - The window does not shrink for the keyboard. Expo SDK 54 and later draw
 *   edge to edge on Android, and edge to edge ignores `adjustResize` (the
 *   `softwareKeyboardLayoutMode: "resize"` default in app.json), so the
 *   keyboard is drawn over the bottom of the app. This is what hid the note
 *   window on Jon's phone.
 * - The window shrinks, on a build that is not edge to edge. The view already
 *   ends at the keyboard's top, so the overlap is zero and nothing is added
 *   twice.
 * - The window pans (`softwareKeyboardLayoutMode: "pan"`). The system has
 *   already moved the view up, so again its bottom sits at or above the top of
 *   the keyboard.
 *
 * `keyboardTop` is the keyboard's top edge in window coordinates. Some
 * Android builds report 0 for it, so then it is worked out from the heights.
 */
export function keyboardOverlap({
  viewBottom,
  keyboardTop,
  keyboardHeight,
  windowHeight,
}: {
  viewBottom: number;
  keyboardTop: number;
  keyboardHeight: number;
  windowHeight: number;
}): number {
  if (!(keyboardHeight > 0)) return 0;
  const top = keyboardTop > 0 ? keyboardTop : windowHeight - keyboardHeight;
  const overlap = viewBottom - top;
  if (!Number.isFinite(overlap) || overlap <= 0) return 0;
  return Math.round(Math.min(overlap, keyboardHeight));
}

export type NoteEditorLayout = {
  /** "typing": the one bar on the keyboard. "full": the whole editor. */
  mode: "typing" | "full";
  /** Photo beside the controls (landscape, tablet) or above them (portrait phone). */
  arrangement: "side" | "stacked";
  /** The editor's width; null to span the screen between its margins. */
  width: number | null;
  /** The photo's box in the full editor. */
  photo: { width: number; height: number };
  /** The photo in the typing bar: small, so the note has the room. */
  typingThumb: number;
  /** The tallest the typed note may grow before it scrolls inside itself. */
  noteMaxHeight: number;
};

/**
 * The editor's shape for a screen and a keyboard.
 *
 * `wide` is a tablet by its short side (600pt and over), where the editor
 * docks on the right, as the camera's controls do, with its actions on the
 * right. A phone held sideways puts the photo beside the controls, because
 * stacked there would leave no room for the note at all.
 */
export function noteEditorLayout({
  width,
  height,
  keyboard,
  typing,
  wide,
}: {
  /** The room the editor has: the window less its safe insets. */
  width: number;
  height: number;
  /** The keyboard's overlap, from `keyboardOverlap`. */
  keyboard: number;
  /**
   * The keyboard is up. Not the same as an overlap: a window that resized
   * for the keyboard has none, and the editor still folds so it fits.
   */
  typing: boolean;
  wide: boolean;
}): NoteEditorLayout {
  const landscape = width > height;
  const mode = typing || keyboard > 0 ? "typing" : "full";
  const arrangement = wide || landscape ? "side" : "stacked";
  const editorWidth = wide ? Math.min(560, Math.max(420, Math.round(width * 0.45))) : null;
  const inner = (editorWidth ?? width) - 2 * 16;
  let photo: { width: number; height: number };
  if (arrangement === "side") {
    /* A third of the editor, and never taller than half the screen. */
    const side = Math.round(Math.min(inner * 0.4, height * 0.5, 240));
    photo = { width: side, height: side };
  } else {
    /* Full width, 4:3, capped so the controls below still fit. */
    const h = Math.round(Math.min((inner * 3) / 4, height * 0.32));
    photo = { width: inner, height: h };
  }
  /* What is left above the keyboard, less the bar's padding and the hint. */
  const room = height - keyboard;
  const noteMaxHeight = Math.max(44, Math.min(140, room - 96));
  return {
    mode,
    arrangement,
    width: editorWidth,
    photo,
    typingThumb: room < 180 ? 40 : 56,
    noteMaxHeight,
  };
}
