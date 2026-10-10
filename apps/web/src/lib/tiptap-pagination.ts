import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Automatic page breaks, drawn the way the pages will print.
 *
 * "the page break should be there nicely formatted and not distort document and
 * show in the middle of a form and break that form into another page."
 *
 * The editor used to draw a dashed line wherever 11 inches ran out, straight
 * through a table if that is where it fell. Now the document is laid out as
 * sheets: a block that would straddle the bottom of a page (a form, a photo
 * row, a paragraph) moves to the next page whole, a heading moves with the
 * block under it, and each new page opens with a running header. The same
 * rules the PDF export follows (apps/api/.../page-pdf.ts), so what is on
 * screen is what prints.
 *
 * All of it is decoration: nothing is written into the document, so templates
 * and pages keep exactly the HTML they had. Only a block taller than a whole
 * page has to be cut, and that still gets the old dashed line where it will
 * split.
 */

export interface PaginationOptions {
  /** Height of page one's content box, in CSS px. */
  pageContentPx: number;
  /** What the running header takes from pages two onward. */
  headerPx: number;
  /** The page margin, drawn as white above and below the gap between sheets. */
  marginPx: number;
  /** The grey gap between two sheets. */
  gapPx: number;
  /** The running header's text (the document's name). */
  headerText: () => string;
  /** Told the page count whenever it changes. */
  onPageCount?: (pages: number) => void;
}

export interface Block {
  pos: number;
  node: ProseMirrorNode;
  top: number;
  height: number;
}

interface SheetBreak {
  /** The block the new page starts with. */
  pos: number;
  /** Blank space left at the foot of the page before it. */
  fill: number;
  page: number;
}

interface Cut {
  /** A block too tall for one page, and where inside it the page ends. */
  pos: number;
  offset: number;
  page: number;
}

export const paginationKey = new PluginKey<DecorationSet>("pagination");
const REFRESH = "paginationRefresh";

const GAP_CLASS = "doc-page-gap";

/** Ask the plugin to lay the pages out again, e.g. after the header text changed. */
export function refreshPagination(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(REFRESH, true).setMeta("addToHistory", false));
}

/**
 * Where every top-level block would sit with no page gaps in the way.
 *
 * Measured off the page as rendered, minus the gaps this plugin has already
 * inserted above each block, so laying the pages out again is stable: the
 * gaps never feed back into where the next ones go.
 */
function measure(view: EditorView): Block[] {
  const origin = view.dom.getBoundingClientRect().top;
  const gaps = Array.from(view.dom.querySelectorAll<HTMLElement>(`.${GAP_CLASS}`)).map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, height: r.height };
  });
  const raw: Array<{ pos: number; node: ProseMirrorNode; top: number; height: number }> = [];
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const r = dom.getBoundingClientRect();
    const above = gaps.reduce((sum, g) => (g.top < r.top ? sum + g.height : sum), 0);
    const style = getComputedStyle(dom);
    const marginTop = parseFloat(style.marginTop) || 0;
    const marginBottom = parseFloat(style.marginBottom) || 0;
    raw.push({
      pos: offset,
      node,
      top: r.top - origin - above - marginTop,
      height: r.height + marginTop + marginBottom,
    });
  });
  return raw;
}

const isHeading = (node: ProseMirrorNode) => node.type.name === "heading";

export function layoutPages(
  blocks: Block[],
  opts: PaginationOptions,
): { breaks: SheetBreak[]; cuts: Cut[]; pages: number } {
  const breaks: SheetBreak[] = [];
  const cuts: Cut[] = [];
  const nextCap = opts.pageContentPx - opts.headerPx;
  let page = 1;
  let pageStart = 0;
  let cap = opts.pageContentPx;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const bottom = block.top + block.height;
    if (bottom - pageStart <= cap) continue;

    if (block.height <= nextCap) {
      /*
       * The block moves to the next page whole. A heading directly above it
       * goes too, so a form's title is never left at the foot of the page
       * before - unless the pair would not fit on a page together.
       */
      let start = i;
      const prev = blocks[i - 1];
      if (
        prev &&
        isHeading(prev.node) &&
        prev.top >= pageStart &&
        bottom - prev.top <= nextCap &&
        (breaks.length === 0 || breaks[breaks.length - 1].pos !== prev.pos)
      ) {
        start = i - 1;
      }
      const startTop = blocks[start].top;
      // Nothing on this page yet: moving would only leave it blank.
      if (startTop <= pageStart) continue;
      page += 1;
      breaks.push({
        pos: blocks[start].pos,
        fill: Math.max(0, cap - (startTop - pageStart)),
        page,
      });
      pageStart = startTop;
      cap = nextCap;
      continue;
    }

    // Taller than a page: it has to split, so mark where.
    while (bottom - pageStart > cap) {
      const at = pageStart + cap;
      page += 1;
      cuts.push({ pos: block.pos, offset: Math.max(0, at - block.top), page });
      pageStart = at;
      cap = nextCap;
    }
  }
  return { breaks, cuts, pages: page };
}

function gapWidget(b: SheetBreak, opts: PaginationOptions, header: string) {
  return () => {
    const el = document.createElement("div");
    el.className = GAP_CLASS;
    el.contentEditable = "false";
    el.setAttribute("aria-hidden", "true");
    const fill = Math.round(b.fill);
    el.style.height = `${fill + opts.marginPx * 2 + opts.gapPx + opts.headerPx}px`;

    const band = document.createElement("div");
    band.className = "doc-page-gap-band";
    band.style.top = `${fill + opts.marginPx}px`;
    band.style.height = `${opts.gapPx}px`;
    band.style.left = `-${opts.marginPx}px`;
    band.style.right = `-${opts.marginPx}px`;
    el.appendChild(band);

    const head = document.createElement("div");
    head.className = "doc-page-gap-header";
    head.style.top = `${fill + opts.marginPx * 2 + opts.gapPx}px`;
    head.style.height = `${opts.headerPx}px`;
    const title = document.createElement("span");
    title.textContent = header;
    const num = document.createElement("span");
    num.textContent = `Page ${b.page}`;
    head.append(title, num);
    el.appendChild(head);
    return el;
  };
}

function cutWidget(c: Cut) {
  return () => {
    const el = document.createElement("div");
    el.className = "doc-page-cut";
    el.contentEditable = "false";
    el.setAttribute("aria-hidden", "true");
    const line = document.createElement("div");
    line.className = "doc-page-break-guide";
    line.style.top = `${Math.round(c.offset)}px`;
    line.dataset.label = `Page ${c.page}`;
    el.appendChild(line);
    return el;
  };
}

export const Pagination = Extension.create<PaginationOptions>({
  name: "pagination",

  addOptions() {
    return {
      pageContentPx: 864,
      headerPx: 40,
      marginPx: 72,
      gapPx: 28,
      headerText: () => "",
      onPageCount: undefined,
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin<DecorationSet>({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const next = tr.getMeta(paginationKey) as DecorationSet | undefined;
            if (next) return next;
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return paginationKey.getState(state);
          },
        },
        view(view) {
          let frame = 0;
          let last = "";
          let lastPages = 0;
          const run = () => {
            frame = 0;
            if (!view.dom.isConnected) return;
            const { breaks, cuts, pages } = layoutPages(measure(view), opts);
            if (pages !== lastPages) {
              lastPages = pages;
              opts.onPageCount?.(pages);
            }
            const header = opts.headerText();
            const signature = JSON.stringify([
              breaks.map((b) => [b.pos, Math.round(b.fill), b.page]),
              cuts.map((c) => [c.pos, Math.round(c.offset), c.page]),
              header,
            ]);
            if (signature === last) return;
            last = signature;
            const decorations = [
              ...breaks.map((b) =>
                Decoration.widget(b.pos, gapWidget(b, opts, header), {
                  side: -1,
                  ignoreSelection: true,
                  key: `gap-${b.page}-${Math.round(b.fill)}-${header}`,
                }),
              ),
              ...cuts.map((c) =>
                Decoration.widget(c.pos, cutWidget(c), {
                  side: -1,
                  ignoreSelection: true,
                  key: `cut-${c.page}-${Math.round(c.offset)}`,
                }),
              ),
            ];
            view.dispatch(
              view.state.tr
                .setMeta(paginationKey, DecorationSet.create(view.state.doc, decorations))
                .setMeta("addToHistory", false),
            );
          };
          const schedule = () => {
            if (frame) return;
            frame = requestAnimationFrame(run);
          };
          // Photos finishing loading change heights without a transaction.
          const observer = new ResizeObserver(schedule);
          observer.observe(view.dom);
          schedule();
          return {
            update: schedule,
            destroy() {
              if (frame) cancelAnimationFrame(frame);
              observer.disconnect();
            },
          };
        },
      }),
    ];
  },
});
