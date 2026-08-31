import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A row's right-hand slot must not crowd out its own title.
 *
 * `ListRow` gives the title `flex: 1, minWidth: 0` and gives the right slot
 * `flexShrink: 0`, on the stated reasoning that a badge squeezed to a sliver is
 * worse than a wrapped title. That is correct for what the prop documents: "a
 * badge, a switch, a small avatar stack".
 *
 * It stops being correct the moment the slot holds a labelled badge AND control
 * buttons. Measured on a 360dp screen, a "Required" badge beside three icon
 * buttons took roughly 260dp, so the title got about 40dp and rendered as
 *
 *     Ov       Ro
 *     e...     o...
 *     Rat      Rat
 *     ing      ing
 *
 * one or two characters a line, while the optional items directly beneath them
 * read normally - which is what made it look like a font bug rather than a
 * layout one. The reports list had the same shape with a "Shared" badge, and
 * every row truncated to "20 Charlco...", leaving five different site reports
 * looking identical.
 *
 * Found by screenshotting the running app. Nothing in tsc, lint or the other
 * 2400 tests had anything to say about it, and the accessibility tree read
 * perfectly: the full label is in the tree whatever width it is drawn at.
 */

const ROOT = join(process.cwd(), "apps/mobile");

/** Windows separator, spelled by code so the escape survives every toolchain. */
const sep = String.fromCharCode(92);

/** Every `right={...}` prop value in a file, matched on balanced braces. */
function rightSlots(source: string): string[] {
  const out: string[] = [];
  const marker = /\bright=\{/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source))) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let i = start;
    for (; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(source.slice(start, i + 1));
  }
  return out;
}

function screens(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (entry.name.endsWith(".tsx")) {
        found.push(full);
      }
    }
  };
  walk(ROOT);
  return found;
}

describe("no row hides its own title behind its controls", () => {
  it("no right slot pairs a labelled badge with control buttons", () => {
    /*
     * `CountBadge` is deliberately not caught: it is a number in a small chip,
     * about 30dp, and the site-log rows pair one with a delete button and still
     * leave the title most of the row. The rule is about width, not about
     * badges.
     */
    const offenders: string[] = [];

    for (const path of screens()) {
      const source = readFileSync(path, "utf8");
      for (const slot of rightSlots(source)) {
        const labelled = /<Badge\b/.test(slot);
        const controls = /<IconButton\b|<Button\b/.test(slot);
        if (labelled && controls) {
          offenders.push(
            path
              .slice(process.cwd().length + 1)
              .split(sep)
              .join("/"),
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("the scanner reads a whole slot, not up to the first closing brace", () => {
    /*
     * The guard is only worth having if it sees past the nested style object.
     * A naive `right=\{([^}]*)\}` stops at the end of `style={{...}}` and finds
     * neither the badge nor the buttons, so every file passes and the check is
     * decorative. This is the exact shape that shipped.
     */
    const sample = [
      "<ListRow",
      "  right={",
      '    <View style={{ flexDirection: "row", gap: 4 }}>',
      '      <Badge label="Required" />',
      "      <IconButton icon={Trash2} />",
      "    </View>",
      "  }",
      "/>",
    ].join("\n");

    const [slot] = rightSlots(sample);
    expect(slot).toContain("<Badge");
    expect(slot).toContain("<IconButton");
  });
});
