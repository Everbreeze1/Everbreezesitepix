import { z } from "zod";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { AuthedContext } from "../../lib/user-context";
import { getSupabaseAdmin } from "../../lib/supabase";
import { resolvePageImages } from "./pages";

// ============================================================
// Minimal HTML parser — scoped to the constrained, well-formed subset of
// tags our own Tiptap editor ever produces (p/h1-3/strong/em/u/span/ul/ol/li/
// img/table/a). Not a general HTML parser; malformed/foreign HTML is out of
// scope since this editor is the only producer of the input.
// ============================================================

interface ElementNode {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}
interface TextNode {
  type: "text";
  text: string;
}
type HtmlNode = ElementNode | TextNode;

const VOID_TAGS = new Set(["img", "br", "input", "hr"]);

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z0-9:_-]+)(?:=("[^"]*"|'[^']*'))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (!m[1]) continue;
    out[m[1]] = m[2] ? decodeEntities(m[2].slice(1, -1)) : "";
  }
  return out;
}

function parseHtml(html: string): HtmlNode[] {
  const root: HtmlNode[] = [];
  const stack: ElementNode[] = [];
  const currentChildren = () => (stack.length ? stack[stack.length - 1].children : root);
  const tagRe =
    /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z0-9:_-]+(?:="[^"]*"|='[^']*')?)*)\s*(\/?)\s*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    if (m[5] !== undefined) {
      const text = decodeEntities(m[5]);
      if (text) currentChildren().push({ type: "text", text });
      continue;
    }
    if (m[2] === undefined) continue;
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const node: ElementNode = { type: "element", tag, attrs: parseAttrs(m[3] || ""), children: [] };
    currentChildren().push(node);
    if (!VOID_TAGS.has(tag) && m[4] !== "/") stack.push(node);
  }
  return root;
}

// ============================================================
// PDF rendering
// ============================================================

type FontFamilyKey = "helvetica" | "times" | "courier";

interface Style {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: ReturnType<typeof rgb> | null;
  fontFamily: FontFamilyKey | null;
  fontSize: number | null;
}
interface Word {
  text: string;
  style: Style;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TEXT = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.45, 0.49, 0.54);
const BORDER = rgb(0.82, 0.85, 0.88);

function hexToRgb(hex: string): ReturnType<typeof rgb> | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function sanitizeForWinAnsi(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

async function tryEmbedImage(pdf: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 8) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50) return await pdf.embedPng(buf);
    try {
      return await pdf.embedJpg(buf);
    } catch {
      /* try png below */
    }
    try {
      return await pdf.embedPng(buf);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

const HEADER_RESERVE = 26;
const FOOTER_RESERVE = 22;

type FontSet = { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont };

class Layout {
  pdf: PDFDocument;
  fonts: FontSet;
  fontFamilies: Record<FontFamilyKey, FontSet>;
  page!: PDFPage;
  y = 0;
  headerWords: Word[];
  footerWords: Word[];

  constructor(
    pdf: PDFDocument,
    fontFamilies: Record<FontFamilyKey, FontSet>,
    headerWords: Word[] = [],
    footerWords: Word[] = [],
  ) {
    this.pdf = pdf;
    this.fontFamilies = fontFamilies;
    this.fonts = fontFamilies.helvetica;
    this.headerWords = headerWords;
    this.footerWords = footerWords;
  }

  get bottomBoundary(): number {
    return MARGIN + (this.footerWords.length ? FOOTER_RESERVE : 0);
  }

  private drawRunningLine(words: Word[], y: number) {
    if (!words.length) return;
    let x = MARGIN;
    const size = 9;
    for (const w of words) {
      const font = this.fontFor(w.style);
      const txt = sanitizeForWinAnsi(w.text);
      this.page.drawText(txt, { x, y, size, font, color: w.style.color ?? MUTED });
      x += font.widthOfTextAtSize(txt, size) + this.fonts.regular.widthOfTextAtSize(" ", size);
    }
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    if (this.headerWords.length) {
      this.drawRunningLine(this.headerWords, PAGE_H - 34);
      this.page.drawLine({
        start: { x: MARGIN, y: PAGE_H - MARGIN + 2 },
        end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN + 2 },
        thickness: 0.5,
        color: BORDER,
      });
    }
    if (this.footerWords.length) this.drawRunningLine(this.footerWords, MARGIN - 12);
    this.y = PAGE_H - MARGIN - (this.headerWords.length ? HEADER_RESERVE : 0);
  }

  ensureSpace(h: number) {
    if (this.y - h < this.bottomBoundary) this.newPage();
  }

  fontFor(style: Style): PDFFont {
    const family = this.fontFamilies[style.fontFamily ?? "helvetica"];
    if (style.bold && style.italic) return family.boldItalic;
    if (style.bold) return family.bold;
    if (style.italic) return family.italic;
    return family.regular;
  }

  sizeFor(word: Word, fallback: number): number {
    return word.style.fontSize ?? fallback;
  }

  /** Greedy word-wrap across mixed-style runs (font family/size/color/bold/italic/underline all vary per word), drawing as it goes. Returns nothing; mutates y. */
  drawParagraph(words: Word[], opts: { x: number; width: number; size: number; align?: "left" }): void {
    if (!words.length) {
      this.y -= opts.size * 1.4;
      return;
    }
    const lineGap = 5;
    let line: Word[] = [];
    let lineWidth = 0;
    const spaceAt = (sz: number) => this.fonts.regular.widthOfTextAtSize(" ", sz);

    const flush = () => {
      if (!line.length) return;
      const lineSize = Math.max(...line.map((w) => this.sizeFor(w, opts.size)));
      this.ensureSpace(lineSize + lineGap);
      let x = opts.x;
      for (const w of line) {
        const size = this.sizeFor(w, opts.size);
        const font = this.fontFor(w.style);
        const color = w.style.color ?? TEXT;
        const txt = sanitizeForWinAnsi(w.text);
        this.page.drawText(txt, { x, y: this.y - lineSize, size, font, color });
        const width = font.widthOfTextAtSize(txt, size);
        if (w.style.underline) {
          this.page.drawLine({
            start: { x, y: this.y - lineSize - 1.5 },
            end: { x: x + width, y: this.y - lineSize - 1.5 },
            thickness: 0.6,
            color,
          });
        }
        x += width + spaceAt(size);
      }
      this.y -= lineSize + lineGap;
      line = [];
      lineWidth = 0;
    };

    for (const w of words) {
      const size = this.sizeFor(w, opts.size);
      const font = this.fontFor(w.style);
      const txt = sanitizeForWinAnsi(w.text);
      const width = font.widthOfTextAtSize(txt, size);
      const withSpace = lineWidth + (line.length ? spaceAt(size) : 0) + width;
      if (withSpace > opts.width && line.length) {
        flush();
        lineWidth = width;
        line = [w];
      } else {
        lineWidth = withSpace;
        line.push(w);
      }
    }
    flush();
  }
}

function collectInlineWords(node: HtmlNode, inherited: Style): Word[] {
  if (node.type === "text") {
    const parts = node.text.split(/(\s+)/).filter((s) => s.length > 0 && !/^\s+$/.test(s));
    return parts.map((text) => ({ text, style: inherited }));
  }
  const style: Style = { ...inherited };
  if (node.tag === "strong" || node.tag === "b") style.bold = true;
  if (node.tag === "em" || node.tag === "i") style.italic = true;
  if (node.tag === "u") style.underline = true;
  if (node.tag === "span" && node.attrs.style) {
    const colorMatch = /color:\s*(#[0-9a-fA-F]{6}|rgb\([^)]+\))/.exec(node.attrs.style);
    if (colorMatch) {
      if (colorMatch[1].startsWith("#")) style.color = hexToRgb(colorMatch[1]);
      else {
        const nums = colorMatch[1].match(/\d+/g)?.map(Number) ?? [];
        if (nums.length >= 3) style.color = rgb(nums[0] / 255, nums[1] / 255, nums[2] / 255);
      }
    }
    const familyMatch = /font-family:\s*([^;]+)/.exec(node.attrs.style);
    if (familyMatch) {
      const fam = familyMatch[1].toLowerCase();
      style.fontFamily = fam.includes("times") ? "times" : fam.includes("courier") ? "courier" : "helvetica";
    }
    const sizeMatch = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(node.attrs.style);
    if (sizeMatch) style.fontSize = Math.round(parseFloat(sizeMatch[1]));
  }
  const out: Word[] = [];
  for (const child of node.children) out.push(...collectInlineWords(child, style));
  return out;
}

async function renderTable(layout: Layout, table: ElementNode) {
  const rows: ElementNode[] = [];
  const walk = (n: HtmlNode) => {
    if (n.type !== "element") return;
    if (n.tag === "tr") rows.push(n);
    else n.children.forEach(walk);
  };
  table.children.forEach(walk);
  if (!rows.length) return;

  const cellsPerRow = rows.map((r) => r.children.filter((c) => c.type === "element" && (c as ElementNode).tag !== "text"));
  const colCount = Math.max(...cellsPerRow.map((c) => c.length), 1);
  const colWidth = CONTENT_W / colCount;

  for (const row of rows) {
    const cells = row.children.filter((c) => c.type === "element") as ElementNode[];
    layout.ensureSpace(24);
    const rowTop = layout.y;
    let maxLines = 1;
    const cellWords = cells.map((cell) => collectInlineWords(cell, { bold: false, italic: false, underline: false, color: null, fontFamily: null, fontSize: null }));
    // Draw each cell's text, tracking the tallest cell to advance y by.
    for (let i = 0; i < cells.length; i++) {
      const x = MARGIN + i * colWidth;
      const words = cellWords[i];
      let cy = rowTop - 4;
      const lines: Word[][] = [];
      let line: Word[] = [];
      let lineW = 0;
      const size = 10;
      for (const w of words) {
        const width = layout.fontFor(w.style).widthOfTextAtSize(sanitizeForWinAnsi(w.text), size);
        if (lineW + width > colWidth - 12 && line.length) {
          lines.push(line);
          line = [w];
          lineW = width;
        } else {
          line.push(w);
          lineW += width + 3;
        }
      }
      if (line.length) lines.push(line);
      for (const ln of lines) {
        let lx = x + 6;
        for (const w of ln) {
          const font = layout.fontFor(w.style);
          const txt = sanitizeForWinAnsi(w.text);
          layout.page.drawText(txt, { x: lx, y: cy - size, size, font, color: TEXT });
          lx += font.widthOfTextAtSize(txt, size) + 3;
        }
        cy -= size + 4;
      }
      maxLines = Math.max(maxLines, lines.length);
    }
    const rowHeight = maxLines * 14 + 8;
    for (let i = 0; i <= cells.length; i++) {
      layout.page.drawLine({
        start: { x: MARGIN + i * colWidth, y: rowTop },
        end: { x: MARGIN + i * colWidth, y: rowTop - rowHeight },
        thickness: 0.5,
        color: BORDER,
      });
    }
    layout.page.drawLine({ start: { x: MARGIN, y: rowTop }, end: { x: MARGIN + colCount * colWidth, y: rowTop }, thickness: 0.5, color: BORDER });
    layout.page.drawLine({ start: { x: MARGIN, y: rowTop - rowHeight }, end: { x: MARGIN + colCount * colWidth, y: rowTop - rowHeight }, thickness: 0.5, color: BORDER });
    layout.y = rowTop - rowHeight;
  }
  layout.y -= 10;
}

async function renderNode(layout: Layout, node: HtmlNode, listDepth = 0, ordered = false, index = 1) {
  if (node.type === "text") return;
  const empty: Style = { bold: false, italic: false, underline: false, color: null, fontFamily: null, fontSize: null };

  switch (node.tag) {
    case "h1":
    case "h2":
    case "h3": {
      const size = node.tag === "h1" ? 20 : node.tag === "h2" ? 16 : 13;
      layout.ensureSpace(size + 14);
      layout.y -= 6;
      layout.drawParagraph(collectInlineWords(node, { ...empty, bold: true }), { x: MARGIN, width: CONTENT_W, size });
      layout.y -= 4;
      return;
    }
    case "p": {
      layout.drawParagraph(collectInlineWords(node, empty), { x: MARGIN, width: CONTENT_W, size: 11 });
      return;
    }
    case "ul":
    case "ol": {
      const isTaskList = node.attrs["data-type"] === "taskList";
      let i = 1;
      for (const child of node.children) {
        if (child.type !== "element" || child.tag !== "li") continue;
        await renderListItem(layout, child, node.tag === "ol", i, isTaskList);
        i++;
      }
      layout.y -= 4;
      return;
    }
    case "img": {
      const url = node.attrs.src;
      if (url) {
        const img = await tryEmbedImage(layout.pdf, url);
        if (img) {
          const maxW = CONTENT_W * 0.7;
          const ratio = img.height / img.width;
          let w = maxW;
          let h = w * ratio;
          if (h > 320) {
            h = 320;
            w = h / ratio;
          }
          layout.ensureSpace(h + 12);
          layout.page.drawImage(img, { x: MARGIN, y: layout.y - h, width: w, height: h });
          layout.y -= h + 12;
        }
      }
      return;
    }
    case "table": {
      await renderTable(layout, node);
      return;
    }
    default: {
      for (const child of node.children) await renderNode(layout, child, listDepth, ordered, index);
    }
  }
}

async function renderListItem(layout: Layout, li: ElementNode, ordered: boolean, index: number, isTaskList: boolean) {
  const indent = MARGIN + 18;
  let checked: boolean | null = null;
  if (isTaskList) checked = li.attrs["data-checked"] === "true";

  const empty: Style = { bold: false, italic: false, underline: false, color: null, fontFamily: null, fontSize: null };
  const words = collectInlineWords(li, empty);

  layout.ensureSpace(16);
  const markerY = layout.y;
  if (isTaskList) {
    const size = 9;
    layout.page.drawRectangle({
      x: MARGIN, y: markerY - size - 2, width: size, height: size,
      borderColor: checked ? rgb(0.11, 0.4, 0.78) : MUTED, borderWidth: 1,
      color: checked ? rgb(0.11, 0.4, 0.78) : undefined,
    });
  } else {
    const marker = ordered ? `${index}.` : "•";
    layout.page.drawText(marker, { x: MARGIN, y: markerY - 11, size: 11, font: layout.fonts.regular, color: TEXT });
  }

  const savedX = indent;
  const before = layout.y;
  layout.drawParagraph(words, { x: savedX, width: CONTENT_W - (savedX - MARGIN), size: 11 });
  if (layout.y === before) layout.y -= 14;
}

/** Header/footer are rendered as a single running line per page — flattens all inline text across the fragment. */
function wordsFromHtml(html: string | null | undefined): Word[] {
  if (!html) return [];
  const empty: Style = { bold: false, italic: false, underline: false, color: null, fontFamily: null, fontSize: null };
  const words: Word[] = [];
  for (const node of parseHtml(html)) words.push(...collectInlineWords(node, empty));
  return words;
}

async function renderPagePdf(
  title: string,
  resolvedContentHtml: string,
  resolvedHeaderHtml: string | null,
  resolvedFooterHtml: string | null,
): Promise<{ pdfBase64: string; filename: string }> {
  const nodes = parseHtml(resolvedContentHtml);

  const pdf = await PDFDocument.create();
  pdf.setTitle(title.slice(0, 200));
  pdf.setProducer("SitePix");
  pdf.setCreator("SitePix");

  const fontFamilies: Record<FontFamilyKey, FontSet> = {
    helvetica: {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    },
    times: {
      regular: await pdf.embedFont(StandardFonts.TimesRoman),
      bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
      italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
      boldItalic: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
    },
    courier: {
      regular: await pdf.embedFont(StandardFonts.Courier),
      bold: await pdf.embedFont(StandardFonts.CourierBold),
      italic: await pdf.embedFont(StandardFonts.CourierOblique),
      boldItalic: await pdf.embedFont(StandardFonts.CourierBoldOblique),
    },
  };
  const fonts = fontFamilies.helvetica;

  const layout = new Layout(pdf, fontFamilies, wordsFromHtml(resolvedHeaderHtml), wordsFromHtml(resolvedFooterHtml));
  layout.newPage();
  layout.page.drawText(sanitizeForWinAnsi(title), {
    x: MARGIN, y: layout.y - 26, size: 24, font: fonts.bold, color: TEXT,
  });
  layout.y -= 50;
  layout.page.drawLine({ start: { x: MARGIN, y: layout.y }, end: { x: PAGE_W - MARGIN, y: layout.y }, thickness: 0.5, color: BORDER });
  layout.y -= 20;

  for (const node of nodes) await renderNode(layout, node);

  // Page numbers need the final page count, so this runs after all content is laid out.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    const w = fonts.regular.widthOfTextAtSize(label, 8);
    p.drawText(label, { x: PAGE_W - MARGIN - w, y: MARGIN - 12, size: 8, font: fonts.regular, color: MUTED });
  });

  const bytes = await pdf.save();
  const safe = title.replace(/[^\w-]+/g, "_").slice(0, 60) || "page";
  return { pdfBase64: uint8ToBase64(bytes), filename: `${safe}.pdf` };
}

export const generatePagePdfInputSchema = z.object({ pageId: z.string().uuid() });

export async function generatePagePdfService(
  ctx: AuthedContext,
  data: z.infer<typeof generatePagePdfInputSchema>,
): Promise<{ pdfBase64: string; filename: string }> {
  const { data: row, error } = await (ctx.supabase as any)
    .from("project_pages")
    .select("title, content_html, header_html, footer_html")
    .eq("id", data.pageId)
    .single();
  if (error || !row) throw new Error("Page not found");

  const [contentHtml, headerHtml, footerHtml] = await Promise.all([
    resolvePageImages(row.content_html, ctx.supabase),
    row.header_html ? resolvePageImages(row.header_html, ctx.supabase) : Promise.resolve<string | null>(row.header_html),
    row.footer_html ? resolvePageImages(row.footer_html, ctx.supabase) : Promise.resolve<string | null>(row.footer_html),
  ]);
  return renderPagePdf(row.title, contentHtml, headerHtml, footerHtml);
}

export const publicPagePdfInputSchema = z.object({ token: z.string().uuid() });

export async function getPublicProjectPagePdfService(
  data: z.infer<typeof publicPagePdfInputSchema>,
): Promise<{ pdfBase64: string; filename: string }> {
  const admin = getSupabaseAdmin();
  const { data: row, error } = await (admin as any)
    .from("project_pages")
    .select("title, content_html, header_html, footer_html, revoked_at")
    .eq("share_token", data.token)
    .maybeSingle();
  if (error || !row || row.revoked_at) throw new Error("Page not available");

  const supa = admin as any;
  const [contentHtml, headerHtml, footerHtml] = await Promise.all([
    resolvePageImages(row.content_html, supa),
    row.header_html ? resolvePageImages(row.header_html, supa) : Promise.resolve<string | null>(row.header_html),
    row.footer_html ? resolvePageImages(row.footer_html, supa) : Promise.resolve<string | null>(row.footer_html),
  ]);
  return renderPagePdf(row.title, contentHtml, headerHtml, footerHtml);
}
