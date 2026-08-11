// Read-only renderer for rich text stored as HTML (Tiptap output).
// Used in preview + share view to render the SAME block structure that the
// PDF generator parses, keeping browser & PDF visually aligned.
import { createElement, type ReactElement } from "react";
import { parseRich, type RichBlock, type InlineRun } from "@sitepix/shared";
import { cn } from "@/lib/utils";

interface Props {
  /** Optional when `blocks` is supplied — one of the two must be. */
  html?: string | null | undefined;
  className?: string;
  // Optional: render headings smaller (for captions / cover summary)
  size?: "default" | "sm";
  /**
   * Pre-parsed blocks, when the caller has already split the body somewhere
   * (ReportDocument splits on page breaks and renders one group per page).
   * Takes precedence over `html` so there is still exactly one inline renderer.
   */
  blocks?: RichBlock[];
}

export function RichText({ html, className, size = "default", blocks: given }: Props) {
  const blocks = given ?? parseRich(html);
  if (blocks.length === 0) return null;
  const small = size === "sm";
  return (
    <div className={cn("text-[0.95em] leading-relaxed [&>*+*]:mt-2", className)}>
      {blocks.map((b, i) => (
        <BlockRender key={i} block={b} small={small} />
      ))}
    </div>
  );
}

function BlockRender({ block, small }: { block: RichBlock; small: boolean }) {
  /*
   * In a report, ReportDocument splits on page breaks before calling this, so a
   * break never reaches here. It does on the surfaces that have no pages at all
   * — showcases, portfolio, project pages — where the right rendering is
   * nothing. Drawing a stray rule there would leak a report concept into
   * documents that have no concept of a page.
   */
  if (block.type === "pageBreak") return null;
  if (block.type === "heading") {
    const cls = small
      ? block.level === 1
        ? "text-base font-bold"
        : block.level === 2
          ? "text-sm font-bold"
          : "text-sm font-semibold"
      : block.level === 1
        ? "text-3xl font-extrabold tracking-tight text-neutral-900 mt-2 mb-3"
        : block.level === 2
          ? "text-2xl font-bold tracking-tight text-neutral-900 mt-2 mb-2"
          : "text-lg font-semibold text-neutral-900 mt-1 mb-1";
    return createElement(`h${block.level}`, { className: cls }, <Runs runs={block.runs} />);
  }
  if (block.type === "paragraph") {
    return (
      <p
        className={
          small ? "text-sm leading-relaxed" : "leading-relaxed text-[15px] text-neutral-800"
        }
      >
        <Runs runs={block.runs} />
      </p>
    );
  }
  // list — tight bullet-to-text spacing (custom marker via ::before for full control)
  const ListTag = block.ordered ? "ol" : "ul";
  const listCls = block.ordered
    ? "ps-5 space-y-0.5 [counter-reset:li] [&>li]:relative [&>li]:pl-5 [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:text-neutral-500 [&>li]:before:content-[counter(li)_'.'] [&>li]:[counter-increment:li]"
    : "ps-4 space-y-0.5 [&>li]:relative [&>li]:pl-3 [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-0 [&>li]:before:text-neutral-500 [&>li]:before:content-['•']";
  return (
    <ListTag className={cn(listCls, small && "text-sm")}>
      {block.items.map((runs, i) => (
        <li key={i} className="leading-snug">
          <Runs runs={runs} />
        </li>
      ))}
    </ListTag>
  );
}

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((r, i) => {
        // Preserve hard line breaks encoded as \n
        const parts = r.text.split("\n");
        const node = parts.map((p, j) => (
          <span key={j}>
            {p}
            {j < parts.length - 1 && <br />}
          </span>
        ));
        let el: ReactElement = <span key={i}>{node}</span>;
        if (r.italic) el = <em key={i}>{node}</em>;
        if (r.bold) el = <strong key={i}>{r.italic ? <em>{node}</em> : node}</strong>;
        return el;
      })}
    </>
  );
}
