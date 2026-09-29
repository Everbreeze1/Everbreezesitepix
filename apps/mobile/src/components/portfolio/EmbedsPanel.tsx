import { useState } from "react";
import { Alert, View } from "react-native";
import { rotatePortfolioEmbedKey } from "@/api/portfolio";
import {
  DEFAULT_EMBED_OPTIONS,
  gallerySnippet,
  mapSnippet,
  type EmbedOptions,
  type PortfolioSite,
} from "@/api/portfolio-view";
import { openShareSheet } from "@/api/sharing";
import { radius, spacing, useTheme } from "@/theme";
import { Code, RefreshCw, Share2 } from "@/ui/icons";
import { Button, Card, Chip, EmptyState, Text } from "@/ui";
import { SwitchRow } from "./SwitchRow";

/**
 * The Embeds tab: the gallery and map for the website the company already has.
 *
 * The same options and the same snippets as the web's Embeds tab, built by
 * the same rules (`gallerySnippet`, `mapSnippet`). A phone has no clipboard
 * dependency here, so the snippet goes through the share sheet, which offers
 * Copy on both platforms and also reaches whoever maintains the website.
 */
export function EmbedsPanel({
  site,
  webBase,
  onKeyRotated,
}: {
  site: PortfolioSite;
  webBase: string | null;
  onKeyRotated: () => void;
}) {
  const theme = useTheme();
  const [options, setOptions] = useState<EmbedOptions>(DEFAULT_EMBED_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const set = <K extends keyof EmbedOptions>(key: K, value: EmbedOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));

  if (!site.published) {
    return (
      <EmptyState
        icon={Code}
        title="Publish your site first"
        body="Embeds read from the same published work as your portfolio site, so they stay empty until it is live."
      />
    );
  }
  if (!webBase) {
    return <EmptyState icon={Code} title="No website address is set for this build" />;
  }

  const rotate = () =>
    Alert.alert(
      "Rotate the embed key?",
      "Any gallery or map already installed on another website stops working until the new snippet is pasted. Your portfolio address is not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rotate key",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await rotatePortfolioEmbedKey();
              setNote("Embed key rotated. Paste the new snippets on your website.");
              onKeyRotated();
            } catch (e) {
              setNote(e instanceof Error ? e.message : "The key was not rotated.");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  const snippetBox = (code: string) => (
    <View
      style={{
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: theme.colors.secondary,
      }}
    >
      <Text variant="caption" selectable style={{ fontFamily: "monospace" }}>
        {code}
      </Text>
    </View>
  );

  const gallery = gallerySnippet(webBase, site.embed_key, options);
  const map = mapSnippet(webBase, site.embed_key, site.accent_color, options);

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <View style={{ gap: spacing.sm }}>
          <Text variant="bodyStrong">Website gallery</Text>
          <Text variant="caption" tone="muted">
            A grid of your projects, filterable by service. Best on an Our work or Gallery page.
          </Text>
          <Text variant="caption" tone="muted">
            Columns
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            {(["2", "3", "4"] as const).map((n) => (
              <Chip
                key={n}
                label={`${n} across`}
                selected={options.columns === n}
                onPress={() => set("columns", n)}
              />
            ))}
          </View>
          <Text variant="caption" tone="muted">
            Show at most
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            {(["12", "24", "60"] as const).map((n) => (
              <Chip
                key={n}
                label={`${n} projects`}
                selected={options.limit === n}
                onPress={() => set("limit", n)}
              />
            ))}
          </View>
          <SwitchRow
            label="Service filters"
            value={options.filters}
            onChange={(next) => set("filters", next)}
          />
          {snippetBox(gallery)}
          <Button
            label="Share the snippet"
            icon={Share2}
            variant="secondary"
            onPress={() => void openShareSheet(gallery, "Everlumen gallery embed")}
          />
        </View>
      </Card>

      <Card>
        <View style={{ gap: spacing.sm }}>
          <Text variant="bodyStrong">Project map</Text>
          <Text variant="caption" tone="muted">
            A map of where you have worked, one pin per published project.
          </Text>
          <Text variant="caption" tone="muted">
            Height
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            {(["360", "460", "600"] as const).map((n) => (
              <Chip
                key={n}
                label={`${n} px`}
                selected={options.mapHeight === n}
                onPress={() => set("mapHeight", n)}
              />
            ))}
          </View>
          <SwitchRow
            label="Pins in your accent colour"
            value={options.pinColor}
            onChange={(next) => set("pinColor", next)}
          />
          {snippetBox(map)}
          <Button
            label="Share the snippet"
            icon={Share2}
            variant="secondary"
            onPress={() => void openShareSheet(map, "Everlumen map embed")}
          />
        </View>
      </Card>

      {note ? <Text variant="caption">{note}</Text> : null}
      <Button
        label="Rotate embed key"
        icon={RefreshCw}
        variant="ghost"
        disabled={busy}
        onPress={rotate}
      />
    </View>
  );
}
