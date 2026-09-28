import type { ReactNode } from "react";
import { RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { isTwoPane } from "@/api/report-builder-view";
import { spacing, useTheme } from "@/theme";
import { FileText } from "@/ui/icons";
import { EmptyState, Screen } from "@/ui";

/** Whether this window gets the list and the open report side by side. */
export function useReportsTwoPane(): boolean {
  const { width } = useWindowDimensions();
  return isTwoPane(width);
}

/**
 * A report list, and on a tablet the open report beside it.
 *
 * On a phone this is an ordinary scrolling screen and a tap opens the report
 * full screen. From 768 wide (a tablet, or a big phone on its side) the list
 * keeps a narrow column of compact rows on the left and the report opens on
 * the right, read only, so a crew going through a week of reports is not
 * pushing and popping the same two screens forty times. The right side is
 * never the editor: Edit on the report opens that as its own screen.
 */
export function ReportsSplitView({
  list,
  detail,
  refreshing,
  onRefresh,
}: {
  list: ReactNode;
  /** The open report, or null for the placeholder. Ignored on a phone. */
  detail: ReactNode | null;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const theme = useTheme();
  const twoPane = useReportsTwoPane();
  const { width } = useWindowDimensions();

  if (!twoPane) {
    return (
      <Screen
        scroll
        padded={false}
        refreshing={refreshing}
        onRefresh={onRefresh}
        bottomInset={spacing.xxl}
      >
        {list}
      </Screen>
    );
  }

  const listWidth = Math.min(400, Math.max(300, Math.round(width * 0.32)));

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: theme.colors.background }}>
      <View
        style={{
          width: listWidth,
          borderRightWidth: 1,
          borderRightColor: theme.colors.border,
        }}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing ?? false}
                onRefresh={onRefresh}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
              />
            ) : undefined
          }
        >
          {list}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}>
        {detail ?? (
          <View style={{ flex: 1, justifyContent: "center", padding: spacing.xl }}>
            <EmptyState
              icon={FileText}
              title="Pick a report"
              body="Choose a report on the left to read it here."
            />
          </View>
        )}
      </View>
    </View>
  );
}
