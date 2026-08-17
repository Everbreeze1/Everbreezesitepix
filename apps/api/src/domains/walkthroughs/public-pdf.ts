import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { walkthroughSummaryBlocks, type RichBlock } from "@sitepix/shared";
import { getSupabaseAdmin } from "../../lib/supabase";
import {
  drawRichBlocks,
  paginatingSurface,
  sanitizeForWinAnsi,
  type FontSet,
} from "../../lib/pdf-rich";

/**
 * Public PDF export for a walkthrough report or a photo Summary.
 *
 * The summary body is drawn with the same rich-text renderer the project report
 * uses, so the headings and bullets a user sees in the app survive the export.
 * They did not before: this file ran its own extractor that stripped every
 * heading, flattened the bullets into running prose and truncated at 900
 * characters, then handed the result to a wrapper that could not start a second
 * page. The client's words for what came out were "all very unformatted".
 */

interface WalkthroughPdfInput {
  title: string;
  /** No recording behind it: no duration, no narration, no timeline. */
  isSummary: boolean;
  startedAt: string;
  durationSeconds: number;
  summaryMarkdown: string;
  transcript: string;
  project: {
    name: string;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
  profile: {
    full_name?: string | null;
    company?: string | null;
    company_logo_url?: string | null;
    company_phone?: string | null;
    company_address?: string | null;
  } | null;
  photos: Array<{
    photo_id: string;
    offset_seconds: number | null;
    spoken_note: string | null;
    caption: string | null;
    /** Signed or public; empty when the photo could not be resolved. */
    url: string;
  }>;
}

export async function handleWalkthroughPdf(token: string): Promise<Response> {
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
    return new Response("Invalid token", { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: walk } = await (supabaseAdmin as any)
    .from("walkthroughs")
    .select(
      "id, project_id, created_by, title, summary_markdown, transcript, duration_seconds, started_at, status, share_token, source",
    )
    .eq("share_token", token)
    .maybeSingle();
  if (!walk) return new Response("Not found", { status: 404 });
  if (walk.status !== "ready" || !walk.summary_markdown) {
    return new Response("Report is still being generated", { status: 425 });
  }

  const [{ data: project }, { data: profile }, { data: linkRows }] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("name, street, city, state, zip")
      .eq("id", walk.project_id)
      .maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("full_name, company, company_logo_url, company_phone, company_address")
      .eq("id", walk.created_by)
      .maybeSingle(),
    (supabaseAdmin as any)
      .from("walkthrough_photos")
      .select("photo_id, offset_seconds, spoken_note, position")
      .eq("walkthrough_id", walk.id)
      .order("position", { ascending: true }),
  ]);

  const links = (linkRows as any[]) ?? [];
  const urlById = new Map<string, string>();
  const metaById = new Map<string, { caption: string | null }>();
  if (links.length) {
    const ids = links.map((l) => l.photo_id);
    const { data: rows } = await supabaseAdmin
      .from("photos")
      .select("id, storage_path, image_url, caption, taken_at")
      .in("id", ids);
    const list = (rows as any[]) ?? [];
    for (const r of list) metaById.set(r.id, { caption: r.caption ?? null });
    await Promise.all(
      list.map(async (r) => {
        if (r.image_url) {
          urlById.set(r.id, r.image_url);
          return;
        }
        const { data: s } = await supabaseAdmin.storage
          .from("site-photos")
          .createSignedUrl(r.storage_path, 60 * 60);
        urlById.set(r.id, s?.signedUrl ?? "");
      }),
    );
  }

  const safeTitle = String(walk.title ?? "Walkthrough report").slice(0, 200);
  const bytes = await renderWalkthroughPdf({
    title: safeTitle,
    isSummary: (walk as any).source === "summary",
    startedAt: walk.started_at,
    durationSeconds: Number(walk.duration_seconds ?? 0),
    summaryMarkdown: String(walk.summary_markdown ?? ""),
    transcript: String(walk.transcript ?? ""),
    project: (project as any) ?? null,
    profile: (profile as any) ?? null,
    photos: links.map((l) => ({
      photo_id: l.photo_id,
      offset_seconds: l.offset_seconds ?? 0,
      spoken_note: l.spoken_note ?? null,
      caption: metaById.get(l.photo_id)?.caption ?? null,
      url: urlById.get(l.photo_id) ?? "",
    })),
  });

  const filename = `${safeTitle.replace(/[^\w\-]+/g, "_").slice(0, 60) || "walkthrough"}.pdf`;

  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0, must-revalidate",
    },
  });
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

/**
 * The renderer, separated from the fetch so a test can drive it with fixture
 * data and count what actually lands on the page. Exported for
 * tests/walkthrough-summary-pdf.test.ts.
 */
export async function renderWalkthroughPdf(input: WalkthroughPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const safeTitle = input.title.slice(0, 200) || "Walkthrough report";
  pdf.setTitle(safeTitle);
  pdf.setProducer("SitePix");
  pdf.setCreator("SitePix");
  pdf.setCreationDate(new Date());

  const fonts: FontSet = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  const TEXT = rgb(0.12, 0.14, 0.18);
  const MUTED = rgb(0.42, 0.46, 0.5);
  const ACCENT = rgb(0.13, 0.45, 0.85);
  const BORDER = rgb(0.85, 0.87, 0.9);
  const FAINT = rgb(0.95, 0.96, 0.97);

  const { profile, project, photos: links, isSummary } = input;
  const companyName = profile?.company || "SitePix";

  const imgCache = new Map<string, PDFImage | null>();
  async function getImg(id: string, url: string): Promise<PDFImage | null> {
    if (imgCache.has(id)) return imgCache.get(id)!;
    const img = url ? await tryEmbedImage(pdf, url) : null;
    imgCache.set(id, img);
    return img;
  }

  const fmtDur = (s: number) =>
    `${Math.floor(s / 60)}:${(Math.max(0, s) % 60).toString().padStart(2, "0")}`;
  const rawTranscript = input.transcript.replace(/\s+/g, " ").trim();
  const durationSeconds = input.durationSeconds;

  // ---------------- Cover page ----------------
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  y = await drawCompanyHeader(pdf, page, fonts, MARGIN, y, profile, TEXT, MUTED);
  page.drawLine({
    start: { x: MARGIN, y: y - 6 },
    end: { x: PAGE_W - MARGIN, y: y - 6 },
    thickness: 0.5,
    color: BORDER,
  });
  y -= 34;

  // A summary was never walked, so neither the "WALKTHROUGH REPORT"
  // stamp nor a "Duration 0:00" line is true of it. This PDF is the
  // customer-facing deliverable, so both are branched rather than left.
  page.drawText(sanitizeForWinAnsi(isSummary ? "PHOTO SUMMARY" : "WALKTHROUGH REPORT"), {
    x: MARGIN,
    y,
    size: 9,
    font: fonts.bold,
    color: ACCENT,
  });
  y -= 22;
  y = drawWrapped(page, safeTitle, {
    x: MARGIN,
    y,
    maxWidth: CONTENT_W,
    size: 26,
    font: fonts.bold,
    color: TEXT,
    lineGap: 6,
  });
  y -= 6;

  const metaParts = [
    new Date(input.startedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    ...(isSummary ? [] : [`Duration ${fmtDur(durationSeconds)}`]),
    `${links.length} ${links.length === 1 ? "photo" : "photos"}`,
  ];
  const author = profile?.full_name;
  if (author) metaParts.push(`Prepared by ${author}`);
  page.drawText(sanitizeForWinAnsi(metaParts.join("  ·  ")), {
    x: MARGIN,
    y: y - 11,
    size: 10.5,
    font: fonts.regular,
    color: MUTED,
  });
  y -= 30;

  if (project) {
    const addr = [
      project.street,
      [project.city, project.state].filter(Boolean).join(", "),
      project.zip,
    ].filter(Boolean);
    const cardH = addr.length ? 78 : 56;
    page.drawRectangle({
      x: MARGIN,
      y: y - cardH,
      width: CONTENT_W,
      height: cardH,
      color: FAINT,
      borderColor: BORDER,
      borderWidth: 0.5,
    });
    page.drawText("PROJECT", {
      x: MARGIN + 16,
      y: y - 18,
      size: 8,
      font: fonts.bold,
      color: ACCENT,
    });
    page.drawText(sanitizeForWinAnsi(String(project.name ?? "")), {
      x: MARGIN + 16,
      y: y - 38,
      size: 14,
      font: fonts.bold,
      color: TEXT,
    });
    if (addr.length) {
      page.drawText(sanitizeForWinAnsi(addr.join(" · ")), {
        x: MARGIN + 16,
        y: y - 58,
        size: 10,
        font: fonts.regular,
        color: MUTED,
      });
    }
    y -= cardH + 20;
  }

  drawFooter(page, fonts.regular, companyName, MARGIN, MUTED);

  /*
   * The summary, drawn as the structured document it is.
   *
   * `walkthroughSummaryBlocks` is the same reduction the detail and share pages
   * apply, so what a user approves on screen is what prints. Anything that does
   * not fit the cover continues onto a sheet of its own rather than being
   * clipped away below the page edge, which is what the old fixed-page wrapper
   * did to every summary longer than about twelve lines.
   */
  const blocks: RichBlock[] = walkthroughSummaryBlocks(input.summaryMarkdown);
  const heroLink = links[0];
  const heroImg = heroLink ? await getImg(heroLink.photo_id, heroLink.url) : null;

  if (blocks.length || heroImg) {
    page.drawText("SUMMARY", { x: MARGIN, y, size: 9, font: fonts.bold, color: ACCENT });
    y -= 16;

    if (heroImg) {
      const heroH = 182;
      drawFittedImage(
        page,
        heroImg,
        MARGIN,
        y - heroH,
        CONTENT_W,
        heroH,
        BORDER,
        fonts.regular,
        MUTED,
      );
      y -= heroH + 16;
    }

    if (blocks.length) {
      const startSummaryPage = () => {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        let py = PAGE_H - MARGIN;
        drawRunningHeader(page, fonts.regular, safeTitle, "Summary (cont.)", MARGIN, PAGE_W, MUTED);
        py -= 14;
        page.drawLine({
          start: { x: MARGIN, y: py },
          end: { x: PAGE_W - MARGIN, y: py },
          thickness: 0.5,
          color: BORDER,
        });
        py -= 26;
        drawFooter(page, fonts.regular, companyName, MARGIN, MUTED);
        return { page, y: py };
      };
      // MARGIN + 12 reserves the footer band: drawFooter writes at y=24, so a
      // line allowed below the margin would print straight through it.
      const surface = paginatingSurface({ page, bottom: MARGIN + 12, startPage: startSummaryPage });
      y = drawRichBlocks(surface, blocks, {
        x: MARGIN,
        y,
        maxWidth: CONTENT_W,
        baseSize: 11,
        color: TEXT,
        muted: MUTED,
        fonts,
        lineGap: 5,
        headingColor: ACCENT,
      });
      page = surface.page;
    }
  }

  // ---------------- Photo steps ----------------
  // Two photos per page, each with timestamp + spoken narration below.
  const perPage = 2;
  for (let i = 0; i < links.length; i += perPage) {
    const batch = links.slice(i, i + perPage);
    page = pdf.addPage([PAGE_W, PAGE_H]);
    let py = PAGE_H - MARGIN;
    drawRunningHeader(
      page,
      fonts.regular,
      safeTitle,
      `Photos ${i + 1}-${Math.min(i + perPage, links.length)} of ${links.length}`,
      MARGIN,
      PAGE_W,
      MUTED,
    );
    py -= 14;
    page.drawLine({
      start: { x: MARGIN, y: py },
      end: { x: PAGE_W - MARGIN, y: py },
      thickness: 0.5,
      color: BORDER,
    });
    py -= 18;

    const availH = py - MARGIN - 28;
    const rowH = (availH - 20) / perPage;
    const imgBoxW = CONTENT_W * 0.55;
    const capBoxW = CONTENT_W - imgBoxW - 16;

    for (let b = 0; b < batch.length; b++) {
      const l = batch[b];
      const idx = i + b + 1;
      const img = await getImg(l.photo_id, l.url);
      const rowTop = py - b * (rowH + 20);
      const rowBottom = rowTop - rowH;
      drawFittedImage(page, img, MARGIN, rowBottom, imgBoxW, rowH, BORDER, fonts.regular, MUTED);

      // Caption column: photo number + timestamp header, then narration.
      // A summary has no recording, so every offset is 0 - printing
      // "Photo 1 · 0:00" on a client-facing PDF claims a timeline that
      // does not exist.
      let cy = rowTop - 4;
      page.drawText(
        sanitizeForWinAnsi(
          isSummary ? `Photo ${idx}` : `Photo ${idx}  ·  ${fmtDur(l.offset_seconds ?? 0)}`,
        ),
        {
          x: MARGIN + imgBoxW + 16,
          y: cy - 11,
          size: 10,
          font: fonts.bold,
          color: ACCENT,
        },
      );
      cy -= 22;
      const note =
        String(l.spoken_note ?? "").trim() ||
        estimateSpokenNote(
          rawTranscript,
          l.offset_seconds ?? 0,
          links[i + b + 1]?.offset_seconds ?? null,
          durationSeconds,
          i + b,
          links.length,
        );
      if (note) {
        cy = drawWrapped(page, `“${note}”`, {
          x: MARGIN + imgBoxW + 16,
          y: cy,
          maxWidth: capBoxW,
          size: 10.5,
          font: fonts.italic,
          color: TEXT,
          lineGap: 3,
        });
        cy -= 6;
      } else if (!isSummary) {
        // Nothing was ever spoken over a summary, so this would apologise
        // for missing narration under every single photo.
        page.drawText(sanitizeForWinAnsi("No spoken note captured."), {
          x: MARGIN + imgBoxW + 16,
          y: cy - 11,
          size: 10,
          font: fonts.italic,
          color: MUTED,
        });
        cy -= 20;
      }
      if (l.caption && !looksLikeFilename(l.caption)) {
        drawWrapped(page, l.caption, {
          x: MARGIN + imgBoxW + 16,
          y: cy,
          maxWidth: capBoxW,
          size: 9.5,
          font: fonts.regular,
          color: MUTED,
          lineGap: 3,
        });
      }
    }

    drawFooter(page, fonts.regular, companyName, MARGIN, MUTED);
  }

  return await pdf.save();
}

// =========================================================================
// Helpers
// =========================================================================
interface WrapOpts {
  x: number;
  y: number;
  maxWidth: number;
  size: number;
  font: PDFFont;
  color: ReturnType<typeof rgb>;
  lineGap: number;
}

/**
 * Single-font wrapping into a bounded box: the document title, and the caption
 * cells beside each photo. Everything with structure goes through
 * `drawRichBlocks` instead, which is the only one of the two that can start a
 * new page.
 */
function drawWrapped(page: PDFPage, text: string, opts: WrapOpts): number {
  const lineHeight = opts.size + opts.lineGap;
  let y = opts.y;
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (opts.font.widthOfTextAtSize(test, opts.size) > opts.maxWidth && line) {
        page.drawText(sanitizeForWinAnsi(line), {
          x: opts.x,
          y: y - opts.size,
          size: opts.size,
          font: opts.font,
          color: opts.color,
        });
        y -= lineHeight;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) {
      page.drawText(sanitizeForWinAnsi(line), {
        x: opts.x,
        y: y - opts.size,
        size: opts.size,
        font: opts.font,
        color: opts.color,
      });
      y -= lineHeight;
    }
  }
  return y;
}

function looksLikeFilename(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  return (
    /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(t) ||
    /^(?:walkthrough|photo|img|image|dsc|screenshot)[-_ ]?\d/i.test(t) ||
    /^https?:\/\//i.test(t)
  );
}

function estimateSpokenNote(
  transcript: string,
  startSeconds: number,
  endSeconds: number | null,
  durationSeconds: number,
  index: number = 0,
  total: number = 1,
): string | null {
  const words = transcript.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  const totalCount = Math.max(1, total);
  const duration =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : endSeconds && endSeconds > startSeconds
        ? endSeconds
        : 0;
  let startRatio: number;
  let endRatio: number;
  if (duration > 0 && Number.isFinite(startSeconds)) {
    const perPhoto = duration / totalCount;
    const windowStart = Math.max(0, startSeconds - Math.min(8, perPhoto / 2));
    const windowEnd = Math.min(
      duration,
      endSeconds && endSeconds > startSeconds ? endSeconds : startSeconds + Math.max(10, perPhoto),
    );
    startRatio = Math.min(0.95, Math.max(0, windowStart / duration));
    endRatio = Math.min(1, Math.max(startRatio + 0.02, windowEnd / duration));
  } else {
    const share = 1 / totalCount;
    startRatio = Math.min(0.95, index * share);
    endRatio = Math.min(1, (index + 1) * share);
  }
  const start = Math.min(words.length - 1, Math.floor(words.length * startRatio));
  const end = Math.min(words.length, Math.max(start + 6, Math.ceil(words.length * endRatio)));
  return words.slice(start, end).join(" ").trim() || null;
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
  page.drawImage(img, { x: x + (boxW - w) / 2, y: y + (boxH - h) / 2, width: w, height: h });
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
  profile: WalkthroughPdfInput["profile"],
  text: ReturnType<typeof rgb>,
  muted: ReturnType<typeof rgb>,
): Promise<number> {
  const name = profile?.company || "SitePix";
  const logoUrl = profile?.company_logo_url as string | null | undefined;
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
  page.drawText(sanitizeForWinAnsi(`Generated with SitePix · ${company}`), {
    x: margin,
    y: 24,
    size: 8,
    font,
    color,
  });
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
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
    } catch {}
    try {
      return await pdf.embedPng(buf);
    } catch {}
    return null;
  } catch {
    return null;
  }
}
