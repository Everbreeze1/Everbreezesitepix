import { z } from "zod";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { sanitizeCaption } from "@everlumen/shared";
import type { ServiceContext } from "../../lib/user-context";

const todoSchema = z.object({ text: z.string().max(500), done: z.boolean() });
const itemSchema = z.object({
  photoId: z.string().uuid(),
  notes: z.string().max(4000).default(""),
  todos: z.array(todoSchema).max(50).default([]),
});
export const generateSiteLogPdfInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  items: z.array(itemSchema).min(1).max(100),
});

export type GenerateSiteLogPdfInput = z.infer<typeof generateSiteLogPdfInputSchema>;

export async function generateSiteLogPdfService(
  ctx: ServiceContext,
  data: GenerateSiteLogPdfInput,
): Promise<{ pdfBase64: string; filename: string }> {
  const { supabase, userId } = ctx;

  const ids = data.items.map((i) => i.photoId);
  const [{ data: photoRows }, { data: profile }] = await Promise.all([
    supabase.from("photos").select("id, storage_path, caption, taken_at, project_id").in("id", ids),
    supabase
      .from("profiles")
      .select("full_name, company, company_logo_url, company_phone, company_address")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  const photoMap = new Map<string, any>();
  for (const p of (photoRows as any[]) ?? []) photoMap.set(p.id, p);

  // Look up a project name if all photos share one.
  let projectName: string | null = null;
  const projectIds = new Set<string>(
    ((photoRows as any[]) ?? []).map((p) => p.project_id).filter(Boolean),
  );
  if (projectIds.size === 1) {
    const pid = Array.from(projectIds)[0];
    const { data: prj } = await supabase
      .from("projects")
      .select("name")
      .eq("id", pid)
      .maybeSingle();
    projectName = (prj as any)?.name ?? null;
  }

  // Sign every photo URL in parallel.
  const urlById = new Map<string, string>();
  await Promise.all(
    ((photoRows as any[]) ?? []).map(async (p) => {
      const { data: s } = await supabase.storage
        .from("site-photos")
        .createSignedUrl(p.storage_path, 3600);
      if (s?.signedUrl) urlById.set(p.id, s.signedUrl);
    }),
  );

  // -------- PDF setup --------
  const pdf = await PDFDocument.create();
  pdf.setTitle(data.title.slice(0, 200));
  pdf.setProducer("Everlumen");
  pdf.setCreator("Everlumen");
  pdf.setCreationDate(new Date());

  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };

  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 54;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const TEXT = rgb(0.09, 0.11, 0.15);
  const MUTED = rgb(0.3, 0.33, 0.38);
  const SUBTLE = rgb(0.45, 0.49, 0.54);
  const ACCENT = rgb(0.11, 0.4, 0.78);
  const BORDER = rgb(0.82, 0.85, 0.88);
  const FAINT = rgb(0.96, 0.97, 0.98);
  const companyName = (profile as any)?.company || "Everlumen";

  // -------- Cover page --------
  {
    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    y = await drawCompanyHeader(pdf, page, fonts, MARGIN, y, profile, TEXT, MUTED);
    page.drawLine({
      start: { x: MARGIN, y: y - 6 },
      end: { x: PAGE_W - MARGIN, y: y - 6 },
      thickness: 0.5,
      color: BORDER,
    });
    y -= 60;

    const label = "SITE LOG";
    const labelSize = 10;
    const labelW = fonts.bold.widthOfTextAtSize(label, labelSize);
    page.drawText(label, {
      x: (PAGE_W - labelW) / 2,
      y,
      size: labelSize,
      font: fonts.bold,
      color: ACCENT,
    });
    y -= 28;

    const titleSize = 28;
    const titleLines = wrapCentered(data.title, fonts.bold, titleSize, CONTENT_W);
    for (const line of titleLines) {
      const lw = fonts.bold.widthOfTextAtSize(line, titleSize);
      page.drawText(sanitizeForWinAnsi(line), {
        x: (PAGE_W - lw) / 2,
        y: y - titleSize,
        size: titleSize,
        font: fonts.bold,
        color: TEXT,
      });
      y -= titleSize + 8;
    }
    y -= 24;

    // Meta stats
    const stats: Array<{ label: string; value: string }> = [];
    const authorName = (profile as any)?.full_name as string | null;
    if (authorName) stats.push({ label: "PREPARED BY", value: authorName });
    stats.push({
      label: "DATE",
      value: new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    });
    stats.push({ label: "PHOTOS", value: `${data.items.length} included` });

    const colW = CONTENT_W / stats.length;
    const rowTop = y;
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      const cx = MARGIN + colW * i + colW / 2;
      const lw = fonts.bold.widthOfTextAtSize(s.label, 9);
      page.drawText(s.label, {
        x: cx - lw / 2,
        y: rowTop - 12,
        size: 9,
        font: fonts.bold,
        color: SUBTLE,
      });
      const valStr = sanitizeForWinAnsi(truncate(s.value, 32));
      const vw = fonts.bold.widthOfTextAtSize(valStr, 13);
      page.drawText(valStr, {
        x: cx - vw / 2,
        y: rowTop - 32,
        size: 13,
        font: fonts.bold,
        color: TEXT,
      });
    }
    y = rowTop - 52;

    if (projectName) {
      const cardW = Math.min(CONTENT_W, 380);
      const cardH = 66;
      const cardX = (PAGE_W - cardW) / 2;
      const cardTop = y - 6;
      page.drawRectangle({
        x: cardX,
        y: cardTop - cardH,
        width: cardW,
        height: cardH,
        color: FAINT,
        borderColor: BORDER,
        borderWidth: 0.5,
      });
      const pl = "PROJECT";
      const plW = fonts.bold.widthOfTextAtSize(pl, 9);
      page.drawText(pl, {
        x: cardX + (cardW - plW) / 2,
        y: cardTop - 22,
        size: 9,
        font: fonts.bold,
        color: ACCENT,
      });
      const pn = sanitizeForWinAnsi(truncate(projectName, 60));
      const pnW = fonts.bold.widthOfTextAtSize(pn, 15);
      page.drawText(pn, {
        x: cardX + (cardW - pnW) / 2,
        y: cardTop - 46,
        size: 15,
        font: fonts.bold,
        color: TEXT,
      });
    }

    drawFooter(page, fonts.regular, companyName, MARGIN, MUTED);
  }

  // -------- Photo pages: 2 per page, image left / notes+todos right --------
  const PER_PAGE = 2;
  for (let i = 0; i < data.items.length; i += PER_PAGE) {
    const batch = data.items.slice(i, i + PER_PAGE);
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    drawRunningHeader(
      page,
      fonts.regular,
      sanitizeForWinAnsi(data.title),
      `Photos ${i + 1}-${Math.min(i + PER_PAGE, data.items.length)} of ${data.items.length}`,
      MARGIN,
      PAGE_W,
      MUTED,
    );
    let py = PAGE_H - MARGIN - 14;
    page.drawLine({
      start: { x: MARGIN, y: py },
      end: { x: PAGE_W - MARGIN, y: py },
      thickness: 0.5,
      color: BORDER,
    });
    py -= 18;

    const availH = py - MARGIN - 28;
    const gap = 20;
    const rowH = (availH - gap * (batch.length - 1)) / batch.length;
    const imgW = CONTENT_W * 0.48;
    const notesW = CONTENT_W - imgW - 18;

    for (let r = 0; r < batch.length; r++) {
      const it = batch[r];
      const rowTop = py - r * (rowH + gap);
      const rowBottom = rowTop - rowH;
      const meta = photoMap.get(it.photoId);
      const url = urlById.get(it.photoId);
      const img = url ? await tryEmbedImage(pdf, url) : null;

      // Image
      drawFittedImage(page, img, MARGIN, rowBottom, imgW, rowH, BORDER, fonts.regular, MUTED);

      // Index badge
      const badge = `#${i + r + 1}`;
      const bw = fonts.bold.widthOfTextAtSize(badge, 10) + 12;
      page.drawRectangle({
        x: MARGIN + 6,
        y: rowTop - 22,
        width: bw,
        height: 16,
        color: ACCENT,
        borderColor: ACCENT,
        borderWidth: 0,
      });
      page.drawText(badge, {
        x: MARGIN + 12,
        y: rowTop - 18,
        size: 10,
        font: fonts.bold,
        color: rgb(1, 1, 1),
      });

      // Right column: caption, notes, todos
      let ry = rowTop - 2;
      const rx = MARGIN + imgW + 18;

      const cap = meta ? sanitizeCaption(meta.caption) : "";
      if (cap) {
        ry = drawWrapped(page, sanitizeForWinAnsi(cap), {
          x: rx,
          y: ry,
          width: notesW,
          size: 13,
          font: fonts.bold,
          color: TEXT,
          lineGap: 4,
        });
        ry -= 6;
      }

      if (meta?.taken_at) {
        const dt = new Date(meta.taken_at).toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        page.drawText(sanitizeForWinAnsi(dt), {
          x: rx,
          y: ry - 10,
          size: 10,
          font: fonts.italic,
          color: SUBTLE,
        });
        ry -= 18;
      }

      if (it.notes && it.notes.trim()) {
        // Accent bar
        const notesStart = ry;
        const noteText = sanitizeForWinAnsi(it.notes.trim());
        const projectedEnd = drawWrapped(page, noteText, {
          x: rx + 10,
          y: ry - 2,
          width: notesW - 12,
          size: 12,
          font: fonts.regular,
          color: TEXT,
          lineGap: 5,
          dryRun: true,
        });
        const barH = Math.max(20, notesStart - projectedEnd + 2);
        page.drawRectangle({
          x: rx,
          y: notesStart - barH,
          width: 3,
          height: barH,
          color: ACCENT,
        });
        ry = drawWrapped(page, noteText, {
          x: rx + 10,
          y: ry - 2,
          width: notesW - 12,
          size: 12,
          font: fonts.regular,
          color: TEXT,
          lineGap: 5,
        });
        ry -= 10;
      }

      if (it.todos.length) {
        const heading = "ACTION ITEMS";
        page.drawText(heading, {
          x: rx,
          y: ry - 10,
          size: 8,
          font: fonts.bold,
          color: SUBTLE,
        });
        ry -= 20;
        for (const t of it.todos) {
          if (ry < rowBottom + 12) break;
          const box = { x: rx, y: ry - 9, size: 9 };
          page.drawRectangle({
            x: box.x,
            y: box.y,
            width: box.size,
            height: box.size,
            borderColor: t.done ? ACCENT : SUBTLE,
            borderWidth: 1,
            color: t.done ? ACCENT : undefined,
          });
          if (t.done) {
            page.drawText("v", {
              x: box.x + 1.5,
              y: box.y + 1,
              size: 8,
              font: fonts.bold,
              color: rgb(1, 1, 1),
            });
          }
          const txt = sanitizeForWinAnsi(t.text);
          const wrapped = wrapText(txt, fonts.regular, 11, notesW - 16);
          for (let li = 0; li < wrapped.length; li++) {
            page.drawText(wrapped[li], {
              x: rx + 14,
              y: ry - 8 - li * 13,
              size: 11,
              font: fonts.regular,
              color: t.done ? MUTED : TEXT,
            });
          }
          ry -= 13 * wrapped.length + 4;
        }
      }
    }

    drawFooter(page, fonts.regular, companyName, MARGIN, MUTED);
  }

  const bytes = await pdf.save();
  const pdfBase64 = uint8ToBase64(bytes);
  const safe = data.title.replace(/[^\w\-]+/g, "_").slice(0, 60) || "site-log";
  return { pdfBase64, filename: `${safe}.pdf` };
}

// ================= helpers =================

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa exists in workerd + node20
  return btoa(s);
}

function sanitizeForWinAnsi(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2022/g, "•")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const paragraphs = String(text).split(/\r?\n/);
  const out: string[] = [];
  for (const p of paragraphs) {
    if (!p.trim()) {
      out.push("");
      continue;
    }
    const words = p.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const candidate = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function wrapCentered(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  return wrapText(text, font, size, maxWidth);
}

interface DrawWrappedOpts {
  x: number;
  y: number;
  width: number;
  size: number;
  font: PDFFont;
  color: ReturnType<typeof rgb>;
  lineGap: number;
  dryRun?: boolean;
}
function drawWrapped(page: PDFPage, text: string, opts: DrawWrappedOpts): number {
  const lines = wrapText(text, opts.font, opts.size, opts.width);
  let y = opts.y;
  const lh = opts.size + opts.lineGap;
  for (const line of lines) {
    if (!opts.dryRun && line) {
      page.drawText(line, {
        x: opts.x,
        y: y - opts.size,
        size: opts.size,
        font: opts.font,
        color: opts.color,
      });
    }
    y -= lh;
  }
  return y;
}

function drawFittedImage(
  page: PDFPage,
  img: PDFImage | null,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  border: ReturnType<typeof rgb>,
  helv: PDFFont,
  muted: ReturnType<typeof rgb>,
) {
  page.drawRectangle({ x, y, width: boxW, height: boxH, borderColor: border, borderWidth: 0.5 });
  if (!img) {
    page.drawText("Image unavailable", {
      x: x + 8,
      y: y + boxH / 2 - 4,
      size: 9,
      font: helv,
      color: muted,
    });
    return;
  }
  const ratio = img.height / img.width;
  let w = boxW;
  let h = w * ratio;
  if (h > boxH) {
    h = boxH;
    w = h / ratio;
  }
  const ix = x + (boxW - w) / 2;
  const iy = y + (boxH - h) / 2;
  page.drawImage(img, { x: ix, y: iy, width: w, height: h });
}

function drawRunningHeader(
  page: PDFPage,
  font: PDFFont,
  left: string,
  right: string,
  margin: number,
  pageW: number,
  color: ReturnType<typeof rgb>,
) {
  page.drawText(sanitizeForWinAnsi(truncate(left, 60)), {
    x: margin,
    y: page.getHeight() - margin,
    size: 9,
    font,
    color,
  });
  const rw = font.widthOfTextAtSize(right, 9);
  page.drawText(sanitizeForWinAnsi(right), {
    x: pageW - margin - rw,
    y: page.getHeight() - margin,
    size: 9,
    font,
    color,
  });
}

async function drawCompanyHeader(
  pdf: PDFDocument,
  page: PDFPage,
  fonts: FontSet,
  margin: number,
  y: number,
  profile: any,
  text: ReturnType<typeof rgb>,
  muted: ReturnType<typeof rgb>,
): Promise<number> {
  const name = profile?.company || "Everlumen";
  const logoUrl = profile?.company_logo_url as string | null;
  let textX = margin;
  let topY = y;
  if (logoUrl) {
    const logo = await tryEmbedImage(pdf, logoUrl);
    if (logo) {
      const lw = 48;
      const lh = lw * (logo.height / logo.width);
      page.drawImage(logo, { x: margin, y: y - lh, width: lw, height: lh });
      textX = margin + lw + 12;
      topY = y - 4;
    }
  }
  page.drawText(sanitizeForWinAnsi(name), {
    x: textX,
    y: topY - 14,
    size: 14,
    font: fonts.bold,
    color: text,
  });
  let cy = topY - 28;
  if (profile?.company_phone) {
    page.drawText(sanitizeForWinAnsi(String(profile.company_phone)), {
      x: textX,
      y: cy,
      size: 9,
      font: fonts.regular,
      color: muted,
    });
    cy -= 12;
  }
  if (profile?.company_address) {
    page.drawText(sanitizeForWinAnsi(truncate(String(profile.company_address), 80)), {
      x: textX,
      y: cy,
      size: 9,
      font: fonts.regular,
      color: muted,
    });
    cy -= 12;
  }
  return Math.min(cy, y - 50);
}

function drawFooter(
  page: PDFPage,
  font: PDFFont,
  company: string,
  margin: number,
  color: ReturnType<typeof rgb>,
) {
  page.drawText(sanitizeForWinAnsi(`Generated with Everlumen · ${company}`), {
    x: margin,
    y: 24,
    size: 8,
    font,
    color,
  });
}

async function tryEmbedImage(pdf: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 8) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
      return await pdf.embedPng(buf);
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return await pdf.embedJpg(buf);
    try {
      return await pdf.embedJpg(buf);
    } catch {
      /* try png */
    }
    try {
      return await pdf.embedPng(buf);
    } catch {
      /* fall through */
    }
    return null;
  } catch {
    return null;
  }
}
