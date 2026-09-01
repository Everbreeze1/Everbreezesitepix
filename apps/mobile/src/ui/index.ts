/**
 * The Everlumen mobile UI kit.
 *
 * The web app has 47 shadcn primitives under `apps/web/src/components/ui`, and
 * every screen there is assembled from them. The field app had none: 24 files
 * each opened with its own `StyleSheet.create` and drew its own card, its own
 * chip, its own button. That is why the two surfaces look like different
 * products despite sharing a palette, and it is why porting a web feature used
 * to mean redrawing its furniture from scratch.
 *
 * The rule for anything ported from here on: build the screen out of these, and
 * if a piece is missing, add it here rather than in the screen. A screen with a
 * `StyleSheet.create` full of borders and radii is the thing this replaces.
 *
 * Import from `@/ui`, not from the individual files, so a component can be
 * split or renamed without touching call sites.
 */

export {
  Icon,
  iconSize,
  type IconProps,
  type IconSize,
  type IconTone,
  type LucideIcon,
} from "./Icon";
export { Text, type TextProps, type TextTone } from "./Text";
export {
  Button,
  ButtonRow,
  IconButton,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "./Button";
export { Badge, CountBadge, type BadgeProps, type BadgeTone, type BadgeVariant } from "./Badge";
export { Chip, ChipGroup, type ChipOption } from "./Chip";
export { Card, CardHeader, SectionHeader } from "./Card";
export { ListGroup, ListRow, RowDivider, type ListRowProps } from "./ListRow";
export { EmptyState, ErrorState, Skeleton, SkeletonList } from "./State";
export { Screen, ScreenFooter, type ScreenProps } from "./Screen";
export { PageHeader, SearchField, ScreenNote } from "./PageHeader";
export { Field, type FieldProps } from "./Field";
export { ActionSheet, Sheet, type SheetAction } from "./Sheet";
export { ProgressBar, StepProgress } from "./Progress";
export { Avatar, AvatarStack, type AvatarSize } from "./Avatar";
export { PhotoThumb, type PhotoThumbProps } from "./PhotoThumb";
export { DailyLogCard } from "./DailyLogCard";
export { SnippetSheet } from "./SnippetSheet";
export { ProjectCrew } from "./ProjectCrew";
export { ProjectBlueprint } from "./ProjectBlueprint";
export { PhotoSharesSheet } from "./PhotoSharesSheet";
