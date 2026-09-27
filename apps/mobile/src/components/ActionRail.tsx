import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, spacing, useRightRail, useTheme } from "@/theme";
import { Icon, Text, type LucideIcon } from "@/ui";

export type RailAction = {
  /** Stable key; also what tells two actions apart to React. */
  key: string;
  icon: LucideIcon;
  /** What a screen reader says, and on a tablet what the button reads. */
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
};

/** Diameter of the round button on a phone, and the height of the pill on a tablet. */
const SIZE = 64;
/** The secondary actions stacked above the primary one are a size down. */
const SECONDARY_SIZE = 52;

/**
 * The screen's create or capture actions, floating at the lower right.
 *
 * One component so every screen puts them in the same place. Most people tap
 * with their right hand, and the lower right is where that thumb already rests
 * on a phone held in one hand and on a tablet held in two. Every screen that
 * used to float its own button (the project camera, New project, Record) had
 * picked that corner independently with slightly different sizes and offsets;
 * this is those three agreeing.
 *
 * `actions` is ordered top to bottom and the LAST one is the primary: it is
 * drawn in the brand orange and sits lowest, nearest the thumb. Anything above
 * it is a quieter secondary.
 *
 * On a phone in portrait the primary is the round button these screens have
 * always had. On a tablet, or in landscape, each button also shows its label as
 * an extended pill: there is room, and a manager scanning a 12 inch screen
 * reads "New report" faster than a bare plus.
 *
 * `railOnly` is for screens whose phone layout keeps the action in the header,
 * where a busy list cannot push it away. On a tablet the header's right end is
 * a stretch from the thumb, so those screens hand the action to this rail there
 * and drop the header copy, rather than offer it twice.
 *
 * Callers still hide the rail while an empty state offers the same action:
 * two buttons for one intent, side by side, is one too many.
 */
export function ActionRail({
  actions,
  railOnly = false,
  labelled = false,
  bottomOffset = 0,
}: {
  actions: RailAction[];
  /** Draw nothing on a phone in portrait. */
  railOnly?: boolean;
  /** Show labels on a phone too, for an action a bare glyph cannot name. */
  labelled?: boolean;
  /** Extra lift, for a screen with its own bar along the bottom. */
  bottomOffset?: number;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const rail = useRightRail();

  if (actions.length === 0 || (railOnly && !rail)) return null;

  const showLabels = rail || labelled;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        /*
         * A phone in portrait keeps the offsets the old buttons used, so that
         * layout does not move. On the rail layout the corner is also clear of
         * the home indicator and of a landscape notch.
         */
        right: spacing.lg + (rail ? insets.right : 0),
        bottom: spacing.xl + bottomOffset + (rail ? insets.bottom : 0),
        alignItems: "flex-end",
        gap: spacing.md,
      }}
    >
      {actions.map((action, index) => {
        const primary = index === actions.length - 1;
        const size = primary ? SIZE : SECONDARY_SIZE;
        const fill = primary ? theme.colors.primary : theme.colors.card;
        const ink = primary ? theme.colors.primaryForeground : theme.colors.primary;
        return (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityHint={action.hint}
            accessibilityState={{ disabled: Boolean(action.disabled) }}
            disabled={action.disabled}
            onPress={action.onPress}
            style={({ pressed }) => [
              {
                height: size,
                minWidth: size,
                borderRadius: radius.pill,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
                paddingHorizontal: showLabels ? spacing.xl : 0,
                backgroundColor: fill,
                borderWidth: primary ? 0 : 1,
                borderColor: theme.colors.border,
                opacity: action.disabled ? 0.5 : pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
              Platform.select({
                ios: {
                  shadowColor: primary ? theme.colors.primary : "#000",
                  shadowOpacity: primary ? 0.35 : 0.15,
                  shadowRadius: 14,
                  shadowOffset: { width: 0, height: 6 },
                },
                android: { elevation: primary ? 8 : 4 },
                default: {},
              }),
            ]}
          >
            <Icon icon={action.icon} size="lg" color={ink} />
            {showLabels ? (
              <Text variant="bodyStrong" style={{ color: ink }} numberOfLines={1}>
                {action.label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
