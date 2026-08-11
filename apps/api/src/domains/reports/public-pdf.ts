import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { parseRich, type RichBlock, type InlineRun, richIsEmpty } from "@sitepix/shared";
import { sanitizeCaption } from "@sitepix/shared";
import { getSupabaseAdmin } from "../../lib/supabase";
import { selectIn } from "../../lib/chunked-in";

export async function handleReportPdf(token: string): Promise<Response> {
        if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
          return new Response("Invalid token", { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();

        const { data: report } = await (supabaseAdmin as any)
          .from("project_reports")
          .select("id, project_id, created_by, title, summary, subtitle, photo_ids, include_project_info, allow_download, revoked_at, created_at, cover_enabled, cover_show_project_name, cover_show_address, cover_show_date, cover_show_author, photos_per_page, cover_photo_ids")
          .eq("share_token", token)
          .maybeSingle();
        if (!report) return new Response("Not found", { status: 404 });
        if (report.revoked_at) return new Response("Link disabled", { status: 410 });

        const [{ data: project }, { data: profile }, { data: sectionRows }] = await Promise.all([
          supabaseAdmin.from("projects").select("name, description, street, city, state, zip, status").eq("id", report.project_id).maybeSingle(),
          supabaseAdmin.from("profiles").select("full_name, company, company_logo_url, company_phone, company_address").eq("id", report.created_by).maybeSingle(),
          (supabaseAdmin as any).from("project_report_sections").select("id, position, title, body, photos").eq("report_id", report.id).order("position", { ascending: true }),
        ]);

        const sectionList: any[] = (sectionRows as any[]) ?? [];
        const hasSections = sectionList.length > 0;

        const coverPhotoIds: string[] = Array.isArray(report.cover_photo_ids) ? report.cover_photo_ids : [];
        const allPhotoIds = new Set<string>();
        sectionList.forEach((s) => (s.photos ?? []).forEach((p: any) => p?.photo_id && allPhotoIds.add(p.photo_id)));
        coverPhotoIds.forEach((id) => allPhotoIds.add(id));
        const legacyIds: string[] = report.photo_ids ?? [];
        if (!hasSections) legacyIds.forEach((id) => allPhotoIds.add(id));

        const urlById = new Map<string, string>();
        const metaById = new Map<string, any>();
        if (allPhotoIds.size) {
          // Chunked and error-throwing on purpose: this used to be a single
          // `.in()` whose error was dropped by destructuring only `data`, so a
          // report referencing ~398+ photos silently produced a PDF with NO
          // photos and still returned 200. See lib/chunked-in.ts.
          const list = await selectIn<any>(
            Array.from(allPhotoIds),
            (idChunk) =>
              supabaseAdmin
                .from("photos")
                .select("id, storage_path, image_url, caption, phase, tags, taken_at")
                .in("id", idChunk) as any,
            "report photos",
          );
          for (const r of list) metaById.set(r.id, { ...r, caption: sanitizeCaption(r.caption) });
          await Promise.all(list.map(async (r) => {
            if (r.image_url) { urlById.set(r.id, r.image_url); return; }
            const { data: s } = await supabaseAdmin.storage.from("site-photos").createSignedUrl(r.storage_path, 60 * 60);
            urlById.set(r.id, s?.signedUrl ?? "");
          }));
        }

        const pdf = await PDFDocument.create();
        const safeTitle = String(report.title ?? "Project report").slice(0, 200);
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

        const PAGE_W = 612;
        const PAGE_H = 792;
        const MARGIN = 54;
        const CONTENT_W = PAGE_W - MARGIN * 2;
        const TEXT = rgb(0.09, 0.11, 0.15);
        const MUTED = rgb(0.30, 0.33, 0.38);
        const SUBTLE = rgb(0.45, 0.49, 0.54);
        const ACCENT = rgb(0.11, 0.40, 0.78);
        const BORDER = rgb(0.82, 0.85, 0.88);
        const FAINT = rgb(0.96, 0.97, 0.98);

        const companyName = (profile as any)?.company || "SitePix";
        const photosPerPage = Math.min(4, Math.max(1, Number(report.photos_per_page ?? 2))) as 1 | 2 | 3 | 4;

        // -------------------- Image cache --------------------
        const imgCache = new Map<string, PDFImage | null>();
        async function getImg(photoId: string): Promise<PDFImage | null> {
          if (imgCache.has(photoId)) return imgCache.get(photoId)!;
          const url = urlById.get(photoId) ?? "";
          const img = url ? await tryEmbedImage(pdf, url) : null;
          imgCache.set(photoId, img);
          return img;
        }

        // -------------------- Cover page --------------------
        // Total unique photos included in the report
        const totalPhotoIds = new Set<string>();
        sectionList.forEach((s) => (s.photos ?? []).forEach((p: any) => p?.photo_id && totalPhotoIds.add(p.photo_id)));
        coverPhotoIds.forEach((id) => totalPhotoIds.add(id));
        if (!hasSections) legacyIds.forEach((id) => totalPhotoIds.add(id));
        const totalPhotoCount = totalPhotoIds.size;

        if (report.cover_enabled !== false) {
          let page = pdf.addPage([PAGE_W, PAGE_H]);
          let y = PAGE_H - MARGIN;

          // Company header
          y = await drawCompanyHeader(pdf, page, fonts, MARGIN, y, profile, TEXT, MUTED);
          page.drawLine({ start: { x: MARGIN, y: y - 6 }, end: { x: PAGE_W - MARGIN, y: y - 6 }, thickness: 0.5, color: BORDER });
          y -= 60;

          // Small label
          const labelText = "PROJECT REPORT";
          const labelSize = 9;
          const labelW = fonts.bold.widthOfTextAtSize(labelText, labelSize);
          page.drawText(labelText, {
            x: (PAGE_W - labelW) / 2, y, size: labelSize, font: fonts.bold, color: ACCENT,
          });
          y -= 24;

          // Centered big title (wrap manually across up to 3 lines)
          const titleSize = 26;
          const titleLines = wrapCentered(safeTitle, fonts.bold, titleSize, CONTENT_W);
          for (const line of titleLines) {
            const lw = fonts.bold.widthOfTextAtSize(line, titleSize);
            page.drawText(sanitizeForWinAnsi(line), {
              x: (PAGE_W - lw) / 2, y: y - titleSize, size: titleSize, font: fonts.bold, color: TEXT,
            });
            y -= titleSize + 6;
          }
          y -= 10;

          // Centered subtitle (optional, plain text)
          const subtitleRaw = (report as any).subtitle as string | null | undefined;
          if (subtitleRaw && subtitleRaw.trim()) {
            const subtitle = subtitleRaw.trim().slice(0, 240);
            const subSize = 12;
            const subLines = wrapCentered(subtitle, fonts.regular, subSize, CONTENT_W * 0.78);
            for (const line of subLines.slice(0, 3)) {
              const lw = fonts.regular.widthOfTextAtSize(line, subSize);
              page.drawText(sanitizeForWinAnsi(line), {
                x: (PAGE_W - lw) / 2, y: y - subSize, size: subSize, font: fonts.regular, color: MUTED,
              });
              y -= subSize + 4;
            }
            y -= 8;
          }

          y -= 20;

          // Meta stats row (Prepared by · Date · Photos)
          const stats: Array<{ label: string; value: string }> = [];
          const authorName = (profile as any)?.full_name as string | null;
          if (report.cover_show_author !== false && authorName) {
            stats.push({ label: "PREPARED BY", value: authorName });
          }
          if (report.cover_show_date !== false) {
            stats.push({
              label: "DATE",
              value: new Date(report.created_at).toLocaleDateString(undefined, {
                year: "numeric", month: "long", day: "numeric",
              }),
            });
          }
          stats.push({ label: "PHOTOS", value: `${totalPhotoCount} included` });

          if (stats.length) {
            const colW = CONTENT_W / stats.length;
            const rowTop = y;
            for (let i = 0; i < stats.length; i++) {
              const s = stats[i];
              const cx = MARGIN + colW * i + colW / 2;
              const labelW = fonts.bold.widthOfTextAtSize(s.label, 8);
              page.drawText(s.label, { x: cx - labelW / 2, y: rowTop - 10, size: 8, font: fonts.bold, color: SUBTLE });
              const valStr = sanitizeForWinAnsi(truncate(s.value, 32));
              const valW = fonts.bold.widthOfTextAtSize(valStr, 12);
              page.drawText(valStr, { x: cx - valW / 2, y: rowTop - 28, size: 12, font: fonts.bold, color: TEXT });
            }
            y = rowTop - 46;
          }

          // Project card (centered)
          if (report.cover_show_project_name !== false && project) {
            const addrParts = [
              (project as any).street,
              [(project as any).city, (project as any).state].filter(Boolean).join(", "),
              (project as any).zip,
            ].filter(Boolean);
            const showAddr = report.cover_show_address !== false && addrParts.length > 0;
            const cardW = Math.min(CONTENT_W, 380);
            const cardH = showAddr ? 82 : 60;
            const cardX = (PAGE_W - cardW) / 2;
            const cardTop = y - 6;
            page.drawRectangle({ x: cardX, y: cardTop - cardH, width: cardW, height: cardH, color: FAINT, borderColor: BORDER, borderWidth: 0.5 });
            const projLabel = "PROJECT";
            const plW = fonts.bold.widthOfTextAtSize(projLabel, 8);
            page.drawText(projLabel, { x: cardX + (cardW - plW) / 2, y: cardTop - 20, size: 8, font: fonts.bold, color: ACCENT });
            const projName = sanitizeForWinAnsi(truncate(String((project as any).name), 60));
            const pnW = fonts.bold.widthOfTextAtSize(projName, 14);
            page.drawText(projName, { x: cardX + (cardW - pnW) / 2, y: cardTop - 42, size: 14, font: fonts.bold, color: TEXT });
            if (showAddr) {
              const addrStr = sanitizeForWinAnsi(truncate(addrParts.join(" · "), 80));
              const aW = fonts.regular.widthOfTextAtSize(addrStr, 10);
              page.drawText(addrStr, { x: cardX + (cardW - aW) / 2, y: cardTop - 62, size: 10, font: fonts.regular, color: MUTED });
            }
            y = cardTop - cardH - 22;
          }

          // Cover photos
          if (coverPhotoIds.length > 0) {
            const remaining = y - MARGIN - 32;
            const cols = coverPhotoIds.length === 1 ? 1 : coverPhotoIds.length === 2 ? 2 : 3;
            const rows = Math.ceil(coverPhotoIds.length / cols);
            const gap = 10;
            const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
            const cellH = Math.min(cellW * 0.72, (remaining - gap * (rows - 1)) / rows);
            if (cellH > 60) {
              for (let i = 0; i < coverPhotoIds.length; i++) {
                const id = coverPhotoIds[i];
                const img = await getImg(id);
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = MARGIN + col * (cellW + gap);
                const yTop = y - row * (cellH + gap);
                drawFittedImage(page, img, x, yTop - cellH, cellW, cellH, BORDER, fonts.regular, MUTED);
              }
              y -= rows * cellH + (rows - 1) * gap + 12;
            } else if (rows >= 1) {
              // Not enough space — push to a fresh page
              page = pdf.addPage([PAGE_W, PAGE_H]);
              y = PAGE_H - MARGIN;
              drawRunningHeader(page, fonts.regular, safeTitle, "Cover photos", MARGIN, PAGE_W, MUTED);
              y -= 14;
              page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: BORDER });
              y -= 18;
              const availH = y - MARGIN - 32;
              const cellH2 = Math.min(cellW * 0.72, (availH - gap * (rows - 1)) / rows);
              for (let i = 0; i < coverPhotoIds.length; i++) {
                const id = coverPhotoIds[i];
                const img = await getImg(id);
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = MARGIN + col * (cellW + gap);
                const yTop = y - row * (cellH2 + gap);
                drawFittedImage(page, img, x, yTop - cellH2, cellW, cellH2, BORDER, fonts.regular, MUTED);
              }
            }
          }

          drawFooter(page, fonts.regular, companyName, MARGIN, MUTED);
        }

        // -------------------- Sections --------------------
        if (hasSections) {
          for (const sec of sectionList) {
            let page = pdf.addPage([PAGE_W, PAGE_H]);
            let py = PAGE_H - MARGIN;
            drawRunningHeader(page, fonts.regular, safeTitle, `Section ${sec.position + 1}`, MARGIN, PAGE_W, MUTED);
            py -= 14;
            page.drawLine({ start: { x: MARGIN, y: py }, end: { x: PAGE_W - MARGIN, y: py }, thickness: 0.5, color: BORDER });
            py -= 26;

            if (sec.title) {
              py = drawRuns(page, [{ text: String(sec.title), bold: true }], {
                x: MARGIN, y: py, maxWidth: CONTENT_W, size: 26,
                color: TEXT, fonts, lineGap: 6,
              });
              py -= 14;
            }
            if (!richIsEmpty(sec.body)) {
              py = drawRichBlocks(page, parseRich(sec.body), {
                x: MARGIN, y: py, maxWidth: CONTENT_W, baseSize: 11,
                color: TEXT, muted: MUTED, fonts, lineGap: 4,
              });
              py -= 14;
            }

            const secPhotos: any[] = (sec.photos ?? []).map((p: any) => ({ ...p, caption: sanitizeCaption(p?.caption) }));
            if (!secPhotos.length) {
              drawFooter(page, fonts.regular, companyName, MARGIN, MUTED);
              continue;
            }

            for (let i = 0; i < secPhotos.length; i += photosPerPage) {
              const batch = secPhotos.slice(i, i + photosPerPage);
              const needNewPage = !(i === 0 && py > PAGE_H * 0.55);
              if (needNewPage) {
                page = pdf.addPage([PAGE_W, PAGE_H]);
                py = PAGE_H - MARGIN;
                drawRunningHeader(page, fonts.regular, safeTitle, sec.title || `Section ${sec.position + 1}`, MARGIN, PAGE_W, MUTED);
                py -= 14;
                page.drawLine({ start: { x: MARGIN, y: py }, end: { x: PAGE_W - MARGIN, y: py }, thickness: 0.5, color: BORDER });
                py -= 18;
              }

              const availH = py - MARGIN - 28;
              await drawPhotoBatch(page, batch, getImg, photosPerPage, MARGIN, py, CONTENT_W, availH, fonts, TEXT, MUTED, BORDER);
              drawFooter(page, fonts.regular, companyName, MARGIN, MUTED);
            }
          }
        } else {
          // Legacy
          const legacyPhotos = legacyIds
            .filter((id) => metaById.has(id))
            .map((id) => ({ photo_id: id, caption: metaById.get(id)?.caption ?? "" }));
          for (let i = 0; i < legacyPhotos.length; i += photosPerPage) {
            const batch = legacyPhotos.slice(i, i + photosPerPage);
            const page = pdf.addPage([PAGE_W, PAGE_H]);
            let py = PAGE_H - MARGIN;
            drawRunningHeader(page, fonts.regular, safeTitle, `Photos ${i + 1}-${Math.min(i + photosPerPage, legacyPhotos.length)} of ${legacyPhotos.length}`, MARGIN, PAGE_W, MUTED);
            py -= 14;
            page.drawLine({ start: { x: MARGIN, y: py }, end: { x: PAGE_W - MARGIN, y: py }, thickness: 0.5, color: BORDER });
            py -= 18;
            const availH = py - MARGIN - 28;
            await drawPhotoBatch(page, batch, getImg, photosPerPage, MARGIN, py, CONTENT_W, availH, fonts, TEXT, MUTED, BORDER);
            drawFooter(page, fonts.regular, companyName, MARGIN, MUTED);
          }
        }

        const bytes = await pdf.save();
        const filename = `${safeTitle.replace(/[^\w\-]+/g, "_").slice(0, 60) || "report"}.pdf`;

        return new Response(bytes as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${filename}"`,
            "Cache-Control": "no-store, max-age=0, must-revalidate",
          },
        });
}

// =========================================================================
// Rich-text rendering
// =========================================================================
interface FontSet { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont }

function fontFor(run: InlineRun, fonts: FontSet): PDFFont {
  if (run.bold && run.italic) return fonts.boldItalic;
  if (run.bold) return fonts.bold;
  if (run.italic) return fonts.italic;
  return fonts.regular;
}

interface DrawRunsOpts {
  x: number;
  y: number;
  maxWidth: number;
  size: number;
  color: ReturnType<typeof rgb>;
  fonts: FontSet;
  lineGap: number;
}
interface StyledWord { text: string; font: PDFFont; color: ReturnType<typeof rgb>; size: number; isBreak?: boolean }

function flattenWords(runs: InlineRun[], opts: { fonts: FontSet; size: number; color: ReturnType<typeof rgb> }): StyledWord[] {
  const out: StyledWord[] = [];
  for (const r of runs) {
    const f = fontFor(r, opts.fonts);
    const segments = r.text.replace(/\r\n/g, "\n").split("\n");
    segments.forEach((seg, si) => {
      const words = seg.split(/\s+/).filter(Boolean);
      for (const w of words) {
        out.push({ text: sanitizeForWinAnsi(w), font: f, color: opts.color, size: opts.size });
      }
      if (si < segments.length - 1) out.push({ text: "", font: f, color: opts.color, size: opts.size, isBreak: true });
    });
  }
  return out;
}

function drawRuns(page: PDFPage, runs: InlineRun[], opts: DrawRunsOpts): number {
  const words = flattenWords(runs, { fonts: opts.fonts, size: opts.size, color: opts.color });
  if (!words.length) return opts.y;
  const lineHeight = opts.size + opts.lineGap;
  let y = opts.y;
  let line: StyledWord[] = [];
  let lineWidth = 0;

  const flush = () => {
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
    if (w.isBreak) { flush(); continue; }
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

interface DrawBlocksOpts {
  x: number;
  y: number;
  maxWidth: number;
  baseSize: number;
  color: ReturnType<typeof rgb>;
  muted: ReturnType<typeof rgb>;
  fonts: FontSet;
  lineGap: number;
}

function drawRichBlocks(page: PDFPage, blocks: RichBlock[], opts: DrawBlocksOpts): number {
  let y = opts.y;
  for (const b of blocks) {
    if (b.type === "heading") {
      const size = b.level === 1 ? opts.baseSize * 1.6
        : b.level === 2 ? opts.baseSize * 1.35
        : opts.baseSize * 1.15;
      y -= 4;
      // Force bold on all runs for headings
      const boldRuns: InlineRun[] = b.runs.map((r) => ({ ...r, bold: true }));
      y = drawRuns(page, boldRuns, { x: opts.x, y, maxWidth: opts.maxWidth, size, color: opts.color, fonts: opts.fonts, lineGap: 3 });
      y -= 4;
    } else if (b.type === "paragraph") {
      y = drawRuns(page, b.runs, { x: opts.x, y, maxWidth: opts.maxWidth, size: opts.baseSize, color: opts.color, fonts: opts.fonts, lineGap: opts.lineGap });
      y -= 4;
    } else if (b.type === "list") {
      const indent = 14;
      for (let i = 0; i < b.items.length; i++) {
        const marker = b.ordered ? `${i + 1}.` : "•";
        const markerFont = opts.fonts.regular;
        const markerWidth = markerFont.widthOfTextAtSize(marker, opts.baseSize);
        const markerX = b.ordered
          ? opts.x + (indent - 4) - markerWidth
          : opts.x + 2;
        page.drawText(marker, { x: markerX, y: y - opts.baseSize, size: opts.baseSize, font: markerFont, color: opts.color });
        y = drawRuns(page, b.items[i], {
          x: opts.x + indent, y, maxWidth: opts.maxWidth - indent,
          size: opts.baseSize, color: opts.color, fonts: opts.fonts, lineGap: 2,
        });
        y -= 1;
      }
      y -= 3;
    }

  }
  return y;
}

// =========================================================================
// Photo layout
// =========================================================================
async function drawPhotoBatch(
  page: PDFPage,
  batch: Array<{ photo_id: string; caption: string }>,
  getImg: (id: string) => Promise<PDFImage | null>,
  perPage: number,
  margin: number,
  topY: number,
  contentW: number,
  availH: number,
  fonts: FontSet,
  text: ReturnType<typeof rgb>,
  muted: ReturnType<typeof rgb>,
  border: ReturnType<typeof rgb>,
) {
  const captionOpts = (size: number) => ({
    fonts, baseSize: size, color: text, muted, lineGap: 3,
  });

  if (perPage === 1) {
    const sp = batch[0];
    const img = await getImg(sp.photo_id);
    const imgBoxW = contentW * 0.6;
    const capBoxW = contentW - imgBoxW - 18;
    const boxH = Math.min(availH, 540);
    const x0 = margin;
    const y0 = topY - boxH;
    drawFittedImage(page, img, x0, y0, imgBoxW, boxH, border, fonts.regular, muted);
    if (!richIsEmpty(sp.caption)) {
      drawRichBlocks(page, parseRich(sp.caption), {
        ...captionOpts(13), x: x0 + imgBoxW + 18, y: topY - 6, maxWidth: capBoxW,
      });
    }
  } else if (perPage === 2) {
    const rowH = (availH - 18) / 2;
    for (let i = 0; i < batch.length; i++) {
      const sp = batch[i];
      const img = await getImg(sp.photo_id);
      const imgBoxW = contentW * 0.55;
      const capBoxW = contentW - imgBoxW - 16;
      const rowTop = topY - i * (rowH + 18);
      const rowBottom = rowTop - rowH;
      drawFittedImage(page, img, margin, rowBottom, imgBoxW, rowH, border, fonts.regular, muted);
      if (!richIsEmpty(sp.caption)) {
        drawRichBlocks(page, parseRich(sp.caption), {
          ...captionOpts(12), x: margin + imgBoxW + 16, y: rowTop - 6, maxWidth: capBoxW,
        });
      }
    }
  } else if (perPage === 3) {
    const rowH = (availH - 24) / 3;
    for (let i = 0; i < batch.length; i++) {
      const sp = batch[i];
      const img = await getImg(sp.photo_id);
      const imgBoxW = contentW * 0.58;
      const capBoxW = contentW - imgBoxW - 14;
      const rowTop = topY - i * (rowH + 12);
      const rowBottom = rowTop - rowH;
      drawFittedImage(page, img, margin, rowBottom, imgBoxW, rowH, border, fonts.regular, muted);
      if (!richIsEmpty(sp.caption)) {
        drawRichBlocks(page, parseRich(sp.caption), {
          ...captionOpts(11), x: margin + imgBoxW + 14, y: rowTop - 6, maxWidth: capBoxW,
        });
      }
    }
  } else {
    const rowH = (availH - 30) / 4;
    for (let i = 0; i < batch.length; i++) {
      const sp = batch[i];
      const img = await getImg(sp.photo_id);
      const imgBoxW = contentW * 0.58;
      const capBoxW = contentW - imgBoxW - 12;
      const rowTop = topY - i * (rowH + 10);
      const rowBottom = rowTop - rowH;
      drawFittedImage(page, img, margin, rowBottom, imgBoxW, rowH, border, fonts.regular, muted);
      if (!richIsEmpty(sp.caption)) {
        drawRichBlocks(page, parseRich(sp.caption), {
          ...captionOpts(10), x: margin + imgBoxW + 12, y: rowTop - 6, maxWidth: capBoxW,
        });
      }
    }
  }
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
  // soft frame
  page.drawRectangle({ x, y, width: boxW, height: boxH, borderColor: border, borderWidth: 0.5 });
  if (!img) {
    page.drawText("Image unavailable", { x: x + 8, y: y + boxH / 2 - 4, size: 9, font: helv, color: muted });
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
  page.drawText(sanitizeForWinAnsi(truncate(left, 60)), { x: margin, y: page.getHeight() - margin, size: 9, font, color });
  const rw = font.widthOfTextAtSize(right, 9);
  page.drawText(sanitizeForWinAnsi(right), { x: pageW - margin - rw, y: page.getHeight() - margin, size: 9, font, color });
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
  const name = profile?.company || "SitePix";
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
  page.drawText(sanitizeForWinAnsi(name), { x: textX, y: topY - 14, size: 14, font: fonts.bold, color: text });
  let cy = topY - 28;
  if (profile?.company_phone) {
    page.drawText(sanitizeForWinAnsi(String(profile.company_phone)), { x: textX, y: cy, size: 9, font: fonts.regular, color: muted });
    cy -= 12;
  }
  if (profile?.company_address) {
    page.drawText(sanitizeForWinAnsi(truncate(String(profile.company_address), 80)), { x: textX, y: cy, size: 9, font: fonts.regular, color: muted });
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
  page.drawText(sanitizeForWinAnsi(`Generated with SitePix · ${company}`), { x: margin, y: 24, size: 8, font, color });
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

function wrapCentered(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? current + " " + w : w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function extractPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function tryEmbedImage(pdf: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 8) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return await pdf.embedPng(buf);
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return await pdf.embedJpg(buf);
    try { return await pdf.embedJpg(buf); } catch {}
    try { return await pdf.embedPng(buf); } catch {}
    return null;
  } catch { return null; }
}
