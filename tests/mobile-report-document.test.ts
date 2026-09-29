import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReportDocument,
  plainLine,
  reportAddress,
  type ReportDocInput,
} from "../apps/mobile/src/api/report-document";

/*
 * Tapping a report on the phone opens it ready to read, drawn from the same
 * rows and the same page plan the web's ReportDocument and the PDF use. These
 * pin what the reader shows so it stays the client's view, not the builder's.
 */

const base = (): ReportDocInput => ({
  report: {
    title: "Site Visit Report",
    subtitle: null,
    created_at: "2026-09-17T15:00:00Z",
    photos_per_page: 2,
    cover_enabled: true,
    cover_show_project_name: true,
    cover_show_address: true,
    cover_show_date: true,
    cover_show_author: true,
    cover_photo_ids: ["c1"],
  },
  sections: [
    {
      id: "s1",
      title: "Findings",
      body: "<p>Two <strong>fans</strong> to replace.</p>",
      photos: [
        { photo_id: "p1", caption: "Fan one" },
        { photo_id: "p2", caption: "" },
        { photo_id: "c1", caption: "Also on the cover" },
      ],
    },
  ],
  urls: { p1: "https://x/p1.jpg", c1: "https://x/c1.jpg" },
  project: {
    name: "Blue Oak Dental",
    street: "5410 Park Drive",
    city: "Rocklin",
    state: "CA",
    zip: "95765",
  },
  company: { name: "Everbreeze", logoUrl: null, phone: null, address: null },
  authorName: "Ajmal",
});

describe("buildReportDocument", () => {
  it("fills the cover the way the web cover does", () => {
    const doc = buildReportDocument(base());
    expect(doc.cover.enabled).toBe(true);
    expect(doc.cover.authorName).toBe("Ajmal");
    expect(doc.cover.projectName).toBe("Blue Oak Dental");
    expect(doc.cover.address).toBe("5410 Park Drive · Rocklin, CA · 95765");
    expect(doc.cover.dateLabel).toBeTruthy();
    // Each photo once, cover and sections together.
    expect(doc.photoCount).toBe(3);
  });

  it("hides what the cover toggles turn off", () => {
    const input = base();
    input.report.cover_show_author = false;
    input.report.cover_show_date = false;
    input.report.cover_show_address = false;
    const doc = buildReportDocument(input);
    expect(doc.cover.authorName).toBeNull();
    expect(doc.cover.dateLabel).toBeNull();
    expect(doc.cover.address).toBeNull();
  });

  it("pages sections with the PDF's plan, heading on the first page only", () => {
    const doc = buildReportDocument(base());
    // Body on page one, then photos two per page.
    expect(doc.pages.map((p) => p.photos.length)).toEqual([0, 2, 1]);
    expect(doc.pages.map((p) => p.title)).toEqual(["Findings", null, null]);
    expect(doc.pages[1]!.photos[0]).toEqual({
      photoId: "p1",
      uri: "https://x/p1.jpg",
      caption: "Fan one",
    });
    expect(doc.pages[1]!.photos[1]!.uri).toBeNull();
    expect(doc.sectionCount).toBe(1);
  });

  it("never draws a page break as content", () => {
    const input = base();
    input.sections[0]!.body = "<p>One</p><hr><p>Two</p>";
    input.sections[0]!.photos = [];
    const doc = buildReportDocument(input);
    expect(doc.pages).toHaveLength(2);
    for (const page of doc.pages) {
      expect(page.blocks.some((b) => b.type === "pageBreak")).toBe(false);
    }
  });

  it("names an untitled report", () => {
    const input = base();
    input.report.title = "  ";
    expect(buildReportDocument(input).title).toBe("Untitled report");
  });
});

describe("helpers", () => {
  it("reads HTML headings and captions as plain lines", () => {
    expect(plainLine("<p>Before <em>work</em></p>")).toBe("Before work");
    expect(plainLine("Plain")).toBe("Plain");
    expect(plainLine(null)).toBe("");
  });

  it("builds the address without empty parts", () => {
    expect(
      reportAddress({ name: "x", street: null, city: "Rocklin", state: null, zip: null }),
    ).toBe("Rocklin");
    expect(reportAddress(null)).toBe("");
  });
});

describe("the screens", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), "apps/mobile", p), "utf8");

  it("a tapped report opens the reader, not the editor", () => {
    const screen = read("app/(app)/report/[reportId].tsx");
    expect(screen).toContain("<ReportReader");
    expect(screen).not.toContain("<ReportEditor");
    expect(read("app/(app)/report/edit/[reportId].tsx")).toContain("<ReportEditor");
  });

  it("the tablet pane beside a list is read only", () => {
    for (const p of ["app/(app)/reports.tsx", "app/(app)/project/[id]/reports.tsx"]) {
      const s = read(p);
      expect(s, p).toContain("<ReportReader");
      expect(s, p).not.toContain("<ReportEditor");
    }
  });

  it("list rows use a small square thumbnail", () => {
    const card = read("src/components/ReportCard.tsx");
    const side = Number(/const THUMB = (\d+);/.exec(card)?.[1]);
    expect(side).toBeGreaterThanOrEqual(44);
    expect(side).toBeLessThanOrEqual(56);
  });
});
