import type { Project, Photo } from "../types";

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function buildProjectReportHtml(args: {
  project: Project;
  companyName: string | null;
  companyLogo: string | null;
  photos: Photo[];
  analyses: Array<{
    photo_id: string;
    report_text: string | null;
    ocr_text: string | null;
    labels: string[] | null;
    defects: Array<{
      type: string;
      severity: string;
      location?: string;
      description: string;
    }> | null;
    recommendations: string[] | null;
    created_at: string;
  }>;
  urlMap: Record<string, string>;
  includePhotoIds: string[];
}) {
  const { project, companyName, companyLogo, photos, analyses, urlMap, includePhotoIds } = args;
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  const sevColor = (s: string) =>
    s === "critical" || s === "high" ? "#b91c1c" : s === "medium" ? "#b45309" : "#374151";

  const allDefects = analyses.flatMap((a) => a.defects ?? []);
  const counts = {
    critical: allDefects.filter((d) => d.severity === "critical").length,
    high: allDefects.filter((d) => d.severity === "high").length,
    medium: allDefects.filter((d) => d.severity === "medium").length,
    low: allDefects.filter((d) => d.severity === "low").length,
  };

  const sections = includePhotoIds
    .map((pid) => {
      const ph = photoMap.get(pid);
      const a = analyses.find((x) => x.photo_id === pid);
      const img = urlMap[pid];
      const defectsHtml = (a?.defects ?? [])
        .map(
          (d) => `
      <li style="margin:0 0 8px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;">
        <div><span style="font-size:10px;font-weight:700;text-transform:uppercase;color:#fff;background:${sevColor(d.severity)};padding:2px 8px;border-radius:999px;">${escHtml(d.severity)}</span> <strong>${escHtml(d.type)}</strong></div>
        ${d.location ? `<div style="margin-top:4px;color:#6b7280;font-size:12px;">${escHtml(d.location)}</div>` : ""}
        <div style="margin-top:6px;font-size:13px;">${escHtml(d.description)}</div>
      </li>`,
        )
        .join("");
      const recsHtml = (a?.recommendations ?? [])
        .map((r) => `<li style="margin:3px 0;font-size:13px;">${escHtml(r)}</li>`)
        .join("");
      return `
      <section style="page-break-inside:avoid;margin:0 0 28px;padding:18px;border:1px solid #e5e7eb;border-radius:12px;">
        ${ph?.caption ? `<h3 style="margin:0 0 6px;font-size:15px;">${escHtml(ph.caption)}</h3>` : ""}
        ${img ? `<img src="${img}" crossorigin="anonymous" style="width:100%;max-height:420px;object-fit:contain;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;" />` : ""}
        ${a?.ocr_text ? `<div style="margin-top:10px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:4px;">Equipment ID / OCR</div><pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px;font-family:inherit;font-size:13px;margin:0;">${escHtml(a.ocr_text)}</pre></div>` : ""}
        ${a?.defects?.length ? `<div style="margin-top:10px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:4px;">Defects</div><ul style="list-style:none;padding:0;margin:0;">${defectsHtml}</ul></div>` : ""}
        ${a?.report_text ? `<div style="margin-top:10px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:4px;">Field Report</div><div style="font-size:13px;line-height:1.5;">${escHtml(a.report_text)}</div></div>` : ""}
        ${recsHtml ? `<div style="margin-top:10px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:4px;">Recommendations</div><ul style="padding-left:18px;margin:0;">${recsHtml}</ul></div>` : ""}
        ${!a ? `<p style="margin:10px 0 0;color:#6b7280;font-size:13px;font-style:italic;">No AI analysis for this photo yet.</p>` : ""}
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escHtml(project.name)} - Project Report</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111827;margin:0;background:#f3f4f6;}
  .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #e5e7eb;padding:10px 16px;display:flex;justify-content:flex-end;gap:8px;z-index:10;}
  .btn{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer;}
  .btn-primary{background:#111827;color:#fff;border-color:#111827;}
  .page{max-width:820px;margin:24px auto;background:#fff;padding:36px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);}
  .cover{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1px solid #e5e7eb;padding-bottom:16px;margin-bottom:18px;}
  h1{font-size:26px;margin:0 0 4px;}
  .muted{color:#6b7280;font-size:13px;}
  .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0 24px;}
  .stat{border:1px solid #e5e7eb;border-radius:10px;padding:10px;text-align:center;}
  .stat .v{font-size:20px;font-weight:700;}
  .stat .l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-top:2px;}
  @media print { .toolbar{display:none;} body{background:#fff;} .page{box-shadow:none;margin:0;max-width:none;padding:0;} }
</style></head>
<body>
  <div class="toolbar"><button class="btn btn-primary" onclick="window.print()">Print / Save as PDF</button></div>
  <div class="page">
    <div class="cover">
      <div>
        <h1>${escHtml(project.name)}</h1>
        ${project.location ? `<div class="muted">${escHtml(project.location)}</div>` : ""}
        <div class="muted" style="margin-top:4px;">Status: ${escHtml(project.status.replace("_", " "))} · Generated ${escHtml(new Date().toLocaleString())}</div>
        ${project.description ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.5;">${escHtml(project.description)}</p>` : ""}
      </div>
      ${companyLogo ? `<img src="${companyLogo}" crossorigin="anonymous" style="max-height:60px;max-width:160px;object-fit:contain;" alt="${escHtml(companyName ?? "")}" />` : companyName ? `<div style="font-weight:700;">${escHtml(companyName)}</div>` : ""}
    </div>
    <div class="summary">
      <div class="stat"><div class="v">${photos.length}</div><div class="l">Photos</div></div>
      <div class="stat"><div class="v">${analyses.length}</div><div class="l">AI analyses</div></div>
      <div class="stat"><div class="v" style="color:#b91c1c;">${counts.critical + counts.high}</div><div class="l">High / Critical</div></div>
      <div class="stat"><div class="v" style="color:#b45309;">${counts.medium}</div><div class="l">Medium</div></div>
    </div>
    ${sections || `<p class="muted">No photos in this project yet.</p>`}
  </div>
</body></html>`;
}
