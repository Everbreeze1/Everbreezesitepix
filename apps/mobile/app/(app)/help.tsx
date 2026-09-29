import { useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { router, Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { HelpIconId } from "@everlumen/shared/help-guides";
import { helpResults, supportMailto, SUPPORT_EMAIL, WHATS_NEW_PATH } from "@/api/help-view";
import { webAppLink } from "@/lib/api";
import { radius, spacing, useTheme } from "@/theme";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileText,
  FolderKanban,
  FolderOpen,
  Layers,
  LayoutTemplate,
  LifeBuoy,
  Mail,
  MapPin,
  Newspaper,
  Settings,
  Sparkles,
  SquareCheckBig,
  Users,
  Video,
  Workflow,
} from "@/ui/icons";
import {
  Badge,
  Card,
  Columns,
  Icon,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SearchField,
  SectionHeader,
  Text,
  type LucideIcon,
} from "@/ui";

/**
 * Help: the web's Knowledge Base, native, and the ways to reach a person.
 *
 * The articles are the web's own (packages/shared/src/help-guides.ts), so the
 * phone can search and read them offline and without a web session. The web
 * page lives behind sign-in, and the in-app browser has no session, so opening
 * it from here showed a login screen rather than an answer.
 *
 * Where the web links out (What's new, email), this does the same: the in-app
 * browser for the page, the mail app for the address.
 */

const HELP_ICONS: Record<HelpIconId, LucideIcon> = {
  "folder-kanban": FolderKanban,
  camera: Camera,
  "check-square": SquareCheckBig,
  "clipboard-check": ClipboardCheck,
  workflow: Workflow,
  video: Video,
  "file-text": FileText,
  "folder-open": FolderOpen,
  "layout-template": LayoutTemplate,
  users: Users,
  layers: Layers,
  sparkles: Sparkles,
  map: MapPin,
  settings: Settings,
};

export default function HelpScreen() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const results = useMemo(() => helpResults(query), [query]);
  const searching = query.trim().length > 0;
  const whatsNew = webAppLink(WHATS_NEW_PATH);

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openMail = (subject: string) =>
    void Linking.openURL(supportMailto(subject)).catch(() => {});

  return (
    <>
      <Stack.Screen options={{ title: "Help" }} />
      <Screen scroll padded={false} bottomInset={spacing.xxl}>
        <View style={{ paddingTop: spacing.lg }}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search help, e.g. blueprint, roles, tasks"
            accessibilityLabel="Search help topics"
          />
        </View>

        {/* Upright, articles then support. On its side support is the right-hand column. */}
        <Columns minColumn={340} max={2} gap={spacing.md} base={spacing.lg}>
          <View style={{ gap: spacing.md }}>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
              <Text variant="caption" tone="muted">
                {results.summary}
              </Text>
            </View>

            {results.categories.length === 0 ? (
              <View style={{ paddingHorizontal: spacing.lg }}>
                <Text variant="body" tone="muted">
                  No topics match that. Try a different word, or clear the search.
                </Text>
              </View>
            ) : (
              results.categories.map((cat) => (
                <View key={cat.id} style={{ gap: spacing.sm }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.md,
                      paddingHorizontal: spacing.lg,
                      paddingTop: spacing.md,
                    }}
                  >
                    <Icon icon={HELP_ICONS[cat.icon]} size="md" tone="primary" />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">{cat.title}</Text>
                      <Text variant="caption" tone="muted">
                        {cat.blurb}
                      </Text>
                    </View>
                  </View>
                  <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
                    {cat.guides.map((g) => (
                      <GuideCard
                        key={g.id}
                        title={g.title}
                        summary={g.summary}
                        steps={g.steps}
                        tips={g.tips}
                        // Searching opens what matched: the answer belongs on screen.
                        expanded={searching || open.has(g.id)}
                        onToggle={() => toggle(g.id)}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeader title="Still stuck?" />
            <View style={{ paddingHorizontal: spacing.lg }}>
              <ListGroup>
                <ListRow
                  icon={LifeBuoy}
                  title="Report a problem"
                  subtitle="Send it from here, with the recent errors attached"
                  onPress={() => router.push("/report-issue")}
                />
                <RowDivider />
                <ListRow
                  icon={Mail}
                  title="Email support"
                  subtitle={SUPPORT_EMAIL}
                  onPress={() => openMail("Everlumen support")}
                />
                <RowDivider />
                <ListRow
                  icon={Sparkles}
                  title="Suggest a feature"
                  subtitle="Tell us what you would build next"
                  onPress={() => openMail("Everlumen feature idea")}
                />
                <RowDivider />
                <ListRow
                  icon={Newspaper}
                  title="What's new"
                  subtitle="Recent features, improvements and fixes"
                  right={<Badge label="Web" tone="neutral" variant="outline" />}
                  disabled={!whatsNew}
                  onPress={() =>
                    whatsNew ? void WebBrowser.openBrowserAsync(whatsNew) : undefined
                  }
                />
              </ListGroup>
            </View>
          </View>
        </Columns>
      </Screen>
    </>
  );
}

function GuideCard({
  title,
  summary,
  steps,
  tips,
  expanded,
  onToggle,
}: {
  title: string;
  summary: string;
  steps: string[];
  tips?: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  return (
    <Card padded={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={title}
        onPress={onToggle}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          padding: spacing.md,
          minHeight: 48,
          borderRadius: radius.lg,
          backgroundColor: pressed ? theme.colors.secondary : "transparent",
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" tone="muted">
            {summary}
          </Text>
        </View>
        <Icon icon={expanded ? ChevronUp : ChevronDown} size="md" tone="muted" />
      </Pressable>
      {expanded ? (
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm }}>
          {steps.map((step, i) => (
            <View key={i} style={{ flexDirection: "row", gap: spacing.sm }}>
              <Text variant="body" tone="muted" style={{ minWidth: 20 }}>
                {`${i + 1}.`}
              </Text>
              <Text variant="body" tone="muted" style={{ flex: 1 }}>
                {step}
              </Text>
            </View>
          ))}
          {(tips ?? []).map((tip, i) => (
            <View
              key={`tip-${i}`}
              style={{
                flexDirection: "row",
                gap: spacing.sm,
                padding: spacing.md,
                borderRadius: radius.md,
                backgroundColor: theme.colors.secondary,
              }}
            >
              <Badge label="Tip" tone="primary" variant="soft" />
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                {tip}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
