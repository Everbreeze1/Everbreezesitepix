// Run the real Auto Report prompt against the real model and check what comes
// back, without recording a walkthrough in production.
//
//   node scripts/check-auto-report-prompt.mjs [photosPerPage]
//
// Reads GEMINI_API_KEY from apps/api/.env (or the environment). The prompt text
// comes from buildAutoReportPrompt in the walkthroughs service and the system
// message from AUTO_REPORT_SYSTEM_PROMPT, so this cannot drift from what the
// product actually sends.
//
// The checks are the ones the client's complaint turns on: a small number of
// sections, none of them holding a single photo, prose rather than bullets in
// the bookends, and none of the severity language the prompt forbids. It
// finishes by running the model's own answer through consolidateReportSections
// and planSectionPages, so the last line is the page plan a client would get.
//
// Gemini refuses calls from unsupported regions with a 400 FAILED_PRECONDITION.
// That is a property of where it runs, not of the key - run it from wherever
// the deployed API runs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GEMINI_CHAT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envPath = path.join(ROOT, "apps/api/.env");
  if (!fs.existsSync(envPath)) return null;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*GEMINI_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

/** A walkthrough covering three areas, two photos each - the shape the grouping rules are about. */
const TRANSCRIPT = `Okay, starting at the front elevation. The gutter on the north side is pulling
away from the fascia, you can see the gap there. Downspout is disconnected at the bottom, it's just
discharging onto the path. Moving round to the east elevation now. Siding is intact, no obvious
damage, but there's staining under the kitchen window where water has been running down. Now inside,
second floor bathroom. There's a stain on the ceiling directly below the roof valley, about the size
of a dinner plate. Feels dry to touch today. The extractor fan runs but it's venting into the loft
space rather than outside, I can see the flexible duct just ending up there. That's it, back
downstairs and done.`;

const PHOTOS = [
  {
    index: 0,
    offset: 12,
    spoken_note: "Gutter pulling away from fascia, north side",
    caption: null,
  },
  { index: 1, offset: 26, spoken_note: "Downspout disconnected at ground level", caption: null },
  { index: 2, offset: 58, spoken_note: "East elevation siding, general condition", caption: null },
  { index: 3, offset: 71, spoken_note: "Staining under kitchen window", caption: null },
  { index: 4, offset: 118, spoken_note: "Ceiling stain below roof valley", caption: null },
  { index: 5, offset: 140, spoken_note: "Extractor duct terminating in loft", caption: null },
];

const strip = (html) =>
  String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function main() {
  const perPage = Math.min(4, Math.max(1, Number(process.argv[2] ?? 2)));
  const key = loadKey();
  if (!key) {
    console.error("GEMINI_API_KEY not set (looked in the environment and apps/api/.env).");
    return 1;
  }

  const { createServer } = await import("vite");
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: "custom",
  });

  try {
    const svc = await server.ssrLoadModule("/apps/api/src/domains/walkthroughs/service.ts");
    const shared = await server.ssrLoadModule("/packages/shared/src/index.ts");

    const maxPhotoSections = Math.max(
      1,
      Math.min(shared.MAX_AUTO_REPORT_PHOTO_SECTIONS, Math.ceil(PHOTOS.length / perPage)),
    );

    const prompt = svc.buildAutoReportPrompt({
      projectName: "14 Alder Road",
      walkTitle: "Exterior and second floor walkthrough",
      durationSeconds: 168,
      transcript: TRANSCRIPT,
      photos: PHOTOS,
      photosPerPage: perPage,
      maxPhotoSections,
    });

    console.log(`Auto Report prompt: ${PHOTOS.length} photos, ${perPage} per page,`);
    console.log(`at most ${maxPhotoSections} photo-bearing section(s).\n`);

    let res;
    try {
      res = await fetch(GEMINI_CHAT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-flash-latest",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: svc.AUTO_REPORT_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
      });
    } catch (e) {
      console.error(`Could not reach the model: ${e?.message ?? e}`);
      return 2;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (/location is not supported/i.test(body)) {
        console.error("Gemini refused this region (400 FAILED_PRECONDITION).");
        console.error("The key is fine - the call has to originate somewhere Gemini serves.");
        console.error("Run this from the same region as the deployed API.");
        return 2;
      }
      console.error(`Model call failed (${res.status}): ${body.slice(0, 400)}`);
      return 2;
    }

    const raw = (await res.json()).choices?.[0]?.message?.content ?? "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("Model did not return valid JSON:\n", raw.slice(0, 800));
      return 3;
    }

    const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
    console.log(`TITLE       ${parsed.title}`);
    console.log(`SUBTITLE    ${parsed.subtitle}`);
    console.log(`\nINTRO       ${strip(parsed.introduction)}`);
    console.log(`\nSECTIONS (${sections.length})`);
    for (const s of sections) {
      const idx = Array.isArray(s.photo_indices) ? s.photo_indices : [];
      console.log(`  - "${s.title}"  photos: [${idx.join(", ")}]`);
      const body = strip(s.body);
      if (body) console.log(`      ${body.slice(0, 160)}${body.length > 160 ? "..." : ""}`);
    }
    console.log(`\nCONCLUSION  ${strip(parsed.conclusion)}`);

    const withPhotos = sections.filter((s) => (s.photo_indices ?? []).length > 0);
    const assigned = withPhotos.flatMap((s) => s.photo_indices ?? []);
    const banned = /\b(critical|code violation|safety hazard|severity)\b/i;
    const allText = [parsed.introduction, parsed.conclusion, ...sections.map((s) => s.body)].join(
      " ",
    );

    const checks = [
      [
        `at most ${maxPhotoSections} photo-bearing section(s)`,
        withPhotos.length <= maxPhotoSections,
        `${withPhotos.length}`,
      ],
      [
        "no section holds a single photo",
        withPhotos.every((s) => s.photo_indices.length >= Math.min(PHOTOS.length, perPage)),
        withPhotos.map((s) => s.photo_indices.length).join("/"),
      ],
      [
        "no photo assigned twice",
        new Set(assigned).size === assigned.length,
        `${assigned.length} assigned`,
      ],
      [
        "every photo placed",
        new Set(assigned).size === PHOTOS.length,
        `${new Set(assigned).size}/${PHOTOS.length}`,
      ],
      ["intro is prose, not bullets", !/<ul|<li/i.test(String(parsed.introduction ?? "")), ""],
      ["conclusion is prose, not bullets", !/<ul|<li/i.test(String(parsed.conclusion ?? "")), ""],
      ["no invented severity language", !banned.test(allText), ""],
      [
        "headings are short noun phrases",
        sections.every((s) => String(s.title ?? "").split(/\s+/).length <= 6),
        "",
      ],
    ];

    console.log("\nCHECKS");
    let failed = 0;
    for (const [label, ok, detail] of checks) {
      if (!ok) failed++;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
    }

    // What the deterministic guard makes of the model's own answer, and the
    // page plan a client would actually receive.
    const draft = sections.map((s) => ({
      title: s.title,
      body: s.body ?? "",
      photos: (s.photo_indices ?? []).map((i) => `photo-${i}`),
    }));
    const fixed = shared.consolidateReportSections(draft, {
      photosPerPage: perPage,
      maxPhotoSections,
    });
    const pages = fixed
      .flatMap((s) =>
        shared.planSectionPages({ body: s.body, photos: s.photos, photosPerPage: perPage }),
      )
      .filter((p) => p.photos.length > 0)
      .map((p) => p.photos.length);
    console.log(
      `\nAFTER THE GUARD  ${fixed.length} section(s); photo pages hold [${pages.join(", ")}]`,
    );
    if (perPage > 1 && pages.length && pages.every((n) => n === 1)) {
      console.log("  WARNING: still one photo per page.");
      failed++;
    }

    return failed ? 1 : 0;
  } finally {
    await server.close();
  }
}

process.exitCode = await main();
