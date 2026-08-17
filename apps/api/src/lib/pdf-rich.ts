/**
 * Rich-text drawing for pdf-lib documents: headings, paragraphs, bulleted and
 * numbered lists, bold/italic runs, and the pagination that lets any of them
 * run past the foot of a sheet.
 *
 * This lived inside the report PDF and nowhere else, which is why the
 * walkthrough PDF shipped with its own `drawWrapped` - a flat wrapper that knew
 * about neither structure nor page boundaries. A client generated a Summary,
 * saw headings and bullets on screen, opened the PDF and got an unformatted
 * block of prose with the tail missing. Two renderers, one of them well behind
 * the other, is the bug; one renderer is the fix.
 *
 * See `Surface` below for the page-boundary half of the story.
 */
import { rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { InlineRun, RichBlock } from "@sitepix/shared";

export interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

export function fontFor(run: InlineRun, fonts: FontSet): PDFFont {
  if (run.bold && run.italic) return fonts.boldItalic;
  if (run.bold) return fonts.bold;
  if (run.italic) return fonts.italic;
  return fonts.regular;
}

export interface DrawRunsOpts {
  x: number;
  y: number;
  maxWidth: number;
  size: number;
  color: ReturnType<typeof rgb>;
  fonts: FontSet;
  lineGap: number;
}

interface StyledWord {
  text: string;
  font: PDFFont;
  color: ReturnType<typeof rgb>;
  size: number;
  isBreak?: boolean;
}

function flattenWords(
  runs: InlineRun[],
  opts: { fonts: FontSet; size: number; color: ReturnType<typeof rgb> },
): StyledWord[] {
  const out: StyledWord[] = [];
  for (const r of runs) {
    const f = fontFor(r, opts.fonts);
    const segments = r.text.replace(/\r\n/g, "\n").split("\n");
    segments.forEach((seg, si) => {
      const words = seg.split(/\s+/).filter(Boolean);
      for (const w of words) {
        out.push({ text: sanitizeForWinAnsi(w), font: f, color: opts.color, size: opts.size });
      }
      if (si < segments.length - 1)
        out.push({ text: "", font: f, color: opts.color, size: opts.size, isBreak: true });
    });
  }
  return out;
}

/**
 * Where text is drawn, and what happens when it runs out of room.
 *
 * `drawRuns` used to take a bare `PDFPage`, which made it structurally
 * incapable of starting a new one: it decremented `y` with no comparison to the
 * bottom margin and kept calling `drawText` at ever-smaller coordinates. Past
 * roughly 600 words in a section body, lines were emitted at NEGATIVE y - which
 * pdf-lib writes happily and every viewer clips to the MediaBox. The text was
 * simply gone from the client's PDF while the on-screen preview still showed
 * all of it, and the page count never grew to hint that anything was missing.
 *
 * A Surface owns the page, so it can hand back a fresh one mid-paragraph.
 * `fixedSurface` is the opt-out for photo captions, which are drawn into
 * fixed-size cells where paginating would tear a photo grid in half.
 */
export interface Surface {
  page: PDFPage;
  /** Called before drawing `h` points at `y`; returns where to actually draw. */
  ensure(y: number, h: number): { page: PDFPage; y: number };
}

/** Never paginates - for captions and other bounded cells. */
export function fixedSurface(page: PDFPage): Surface {
  return { page, ensure: (y) => ({ page, y }) };
}

/**
 * A surface that calls `startPage` whenever the next line would cross `bottom`.
 *
 * `startPage` must add the sheet, draw whatever furniture it carries (running
 * header, rule, footer) and return the y the body should resume at. Reserve the
 * footer band inside `bottom`: pdf-lib will happily draw a line of prose
 * straight through it.
 */
export function paginatingSurface(opts: {
  page: PDFPage;
  bottom: number;
  startPage: () => { page: PDFPage; y: number };
}): Surface {
  let current = opts.page;
  return {
    get page() {
      return current;
    },
    ensure(y, h) {
      if (Number.isFinite(h) && y - h >= opts.bottom) return { page: current, y };
      const next = opts.startPage();
      current = next.page;
      return { page: current, y: next.y };
    },
  };
}

export function drawRuns(surface: Surface, runs: InlineRun[], opts: DrawRunsOpts): number {
  const words = flattenWords(runs, { fonts: opts.fonts, size: opts.size, color: opts.color });
  if (!words.length) return opts.y;
  const lineHeight = opts.size + opts.lineGap;
  let y = opts.y;
  let line: StyledWord[] = [];
  let lineWidth = 0;

  const flush = () => {
    // Ask for room BEFORE drawing. On a paginating surface this may swap in a
    // new page and reset the cursor to its top margin.
    const at = surface.ensure(y, lineHeight);
    const page = at.page;
    y = at.y;
    let x = opts.x;
    for (let i = 0; i < line.length; i++) {
      const w = line[i];
      page.drawText(w.text, { x, y: y - w.size, size: w.size, font: w.font, color: w.color });
      x += w.font.widthOfTextAtSize(w.text, w.size);
      if (i < line.length - 1) x += line[i + 1].font.widthOfTextAtSize(" ", line[i + 1].size);
    }
    y -= lineHeight;
    line = [];
    lineWidth = 0;
  };

  for (const w of words) {
    if (w.isBreak) {
      flush();
      continue;
    }
    const ww = w.font.widthOfTextAtSize(w.text, w.size);
    const sp = line.length ? w.font.widthOfTextAtSize(" ", w.size) : 0;
    if (line.length && lineWidth + sp + ww > opts.maxWidth) flush();
    if (line.length) lineWidth += w.font.widthOfTextAtSize(" ", w.size);
    line.push(w);
    lineWidth += ww;
  }
  if (line.length) flush();
  return y;
}

export interface DrawBlocksOpts {
  x: number;
  y: number;
  maxWidth: number;
  baseSize: number;
  color: ReturnType<typeof rgb>;
  muted: ReturnType<typeof rgb>;
  fonts: FontSet;
  lineGap: number;
  /** Headings in their own colour, for documents that key sections to an accent. */
  headingColor?: ReturnType<typeof rgb>;
}

export function drawRichBlocks(
  surface: Surface,
  blocks: RichBlock[],
  opts: DrawBlocksOpts,
): number {
  let y = opts.y;
  for (const b of blocks) {
    if (b.type === "heading") {
      const size =
        b.level === 1
          ? opts.baseSize * 1.6
          : b.level === 2
            ? opts.baseSize * 1.35
            : opts.baseSize * 1.15;
      y -= 4;
      // A heading orphaned at the foot of a page reads as a mistake, so claim
      // room for the heading plus one line of whatever follows it.
      y = surface.ensure(y, size * 2 + opts.lineGap).y;
      // Force bold on all runs for headings
      const boldRuns: InlineRun[] = b.runs.map((r) => ({ ...r, bold: true }));
      y = drawRuns(surface, boldRuns, {
        x: opts.x,
        y,
        maxWidth: opts.maxWidth,
        size,
        color: opts.headingColor ?? opts.color,
        fonts: opts.fonts,
        lineGap: 3,
      });
      y -= 4;
    } else if (b.type === "paragraph") {
      y = drawRuns(surface, b.runs, {
        x: opts.x,
        y,
        maxWidth: opts.maxWidth,
        size: opts.baseSize,
        color: opts.color,
        fonts: opts.fonts,
        lineGap: opts.lineGap,
      });
      y -= 4;
    } else if (b.type === "list") {
      const indent = 14;
      for (let i = 0; i < b.items.length; i++) {
        const marker = b.ordered ? `${i + 1}.` : "•";
        const markerFont = opts.fonts.regular;
        const markerWidth = markerFont.widthOfTextAtSize(marker, opts.baseSize);
        const markerX = b.ordered ? opts.x + (indent - 4) - markerWidth : opts.x + 2;
        // Break lists between items, never between a bullet and its text -
        // the marker and the first line have to land on the same page.
        const at = surface.ensure(y, opts.baseSize + opts.lineGap);
        y = at.y;
        at.page.drawText(marker, {
          x: markerX,
          y: y - opts.baseSize,
          size: opts.baseSize,
          font: markerFont,
          color: opts.color,
        });
        y = drawRuns(surface, b.items[i], {
          x: opts.x + indent,
          y,
          maxWidth: opts.maxWidth - indent,
          size: opts.baseSize,
          color: opts.color,
          fonts: opts.fonts,
          lineGap: 2,
        });
        y -= 1;
      }
      y -= 3;
    } else if (b.type === "pageBreak") {
      /*
       * `planSectionPages` strips breaks before the report's section loop gets
       * here, so this is unreachable on the normal path - but the chain must be
       * total or a break arriving by any other route would be silently skipped,
       * which is exactly the class of bug that made a long body vanish.
       */
      y = surface.ensure(y, Number.POSITIVE_INFINITY).y;
    }
  }
  return y;
}

/**
 * The StandardFonts are WinAnsi-encoded, and pdf-lib throws on a glyph the
 * encoding has no slot for. Fold the typographic characters an AI draft is full
 * of down to their ASCII equivalents, then drop whatever is left.
 *
 * The list marker in `drawRichBlocks` is drawn unsanitised on purpose. U+2022
 * IS in WinAnsi (0x95), but the closing character class here cannot say so
 * without letting the rest of the BMP through with it.
 */
export function sanitizeForWinAnsi(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}
