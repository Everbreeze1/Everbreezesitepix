import { Children, isValidElement, type ReactNode } from "react";
import { View } from "react-native";
import { spacing, useLayout } from "@/theme";

/**
 * Sections side by side when the screen is on its side.
 *
 * Upright this is a plain stack with a gap, exactly what the screens drew
 * before, so wrapping a screen's sections in it cannot move a portrait layout.
 * On its side (`useLayout().spread`) the sections are dealt into as many
 * columns as fit at `minColumn`, left to right and then down, so the first
 * section stays top left where it was and nothing is hidden or reordered in a
 * way a reader would notice.
 *
 * Dealt into separate stacks rather than wrapped in rows: sections are of very
 * different heights (a two-row group beside a ten-row one), and a wrapping row
 * would leave a hole under every short one.
 */
export function Columns({
  children,
  minColumn = 320,
  max = 3,
  gap = spacing.md,
  base = spacing.lg,
}: {
  children: ReactNode;
  /** Narrowest a column may get before one fewer is used. */
  minColumn?: number;
  max?: number;
  gap?: number;
  /** The page gutter the content sits inside, for the width arithmetic. */
  base?: number;
}) {
  const layout = useLayout();
  const items = Children.toArray(children).filter(Boolean);
  const count = Math.min(layout.columns(minColumn, max, base), Math.max(1, items.length));

  if (count <= 1) return <View style={{ gap }}>{items}</View>;

  const stacks: ReactNode[][] = Array.from({ length: count }, () => []);
  items.forEach((child, index) => {
    stacks[index % count]?.push(
      isValidElement(child) ? child : <View key={`column-item-${index}`}>{child}</View>,
    );
  });

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap }}>
      {stacks.map((stack, index) => (
        <View key={index} style={{ flex: 1, minWidth: 0, gap }}>
          {stack}
        </View>
      ))}
    </View>
  );
}

/**
 * A list with its detail beside it, the master-detail layout of every tablet
 * settings screen. Only drawn by callers that asked `useLayout().split()`; the
 * list keeps a readable fixed width and the detail takes the rest.
 */
export function SplitPane({
  list,
  detail,
  listWidth = 340,
  gap = spacing.lg,
}: {
  list: ReactNode;
  detail: ReactNode;
  listWidth?: number;
  gap?: number;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap }}>
      <View style={{ width: listWidth, gap: spacing.md }}>{list}</View>
      <View style={{ flex: 1, minWidth: 0, gap: spacing.md }}>{detail}</View>
    </View>
  );
}
