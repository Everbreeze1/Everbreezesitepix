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
import { radius, spacing, useLayout, useRightRail, useTheme } from "@/theme";
import { Code, Grid3x3, MapPin, RefreshCw, Share2 } from "@/ui/icons";
import { Button, Card, Chip, EmptyState, ListGroup, ListRow, RowDivider, Sheet, Text } from "@/ui";
import { SwitchRow } from "./SwitchRow";

/**
 * The Embeds tab: the gallery and map for the website the company already has.
 *
 * The same options and the same snippets as the web's Embeds tab, built by
 * the same rules (`gallerySnippet`, `mapSnippet`). The tab itself is two rows;
 * each opens a sheet with that embed's few options, its snippet and Share, so
 * the options for one never sit in the way of the other. A phone has no clipboard
 * dependency here, so the snippet goes through the share sheet, which offers
 * Copy on both platforms and also reaches whoever maintains the website.
 *
 * On a screen held on its side the two embeds sit next to each other, each
 * with its options and snippet open, since there is room for both and neither
 * is then in the way of the other.
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
  const rail = useRightRail();
  const layout = useLayout();
  const sideBySide = layout.spread && layout.columns(300, 2) > 1;
  const [options, setOptions] = useState<EmbedOptions>(DEFAULT_EMBED_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<"gallery" | "map" | null>(null);
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

  const gallery = gallerySnippet(webBase, site.embed_key, options);
  const map = mapSnippet(webBase, site.embed_key, site.accent_color, options);
  const snippet = open === "map" ? map : gallery;

  const choices = <T extends string>(
    label: string,
    values: readonly T[],
    current: T,
    text: (v: T) => string,
    pick: (v: T) => void,
  ) => (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
        {values.map((v) => (
          <Chip key={v} label={text(v)} selected={current === v} onPress={() => pick(v)} />
        ))}
      </View>
    </View>
  );

  const embedOptions = (kind: "gallery" | "map") =>
    kind === "map" ? (
      <>
        {choices(
          "Height",
          ["360", "460", "600"] as const,
          options.mapHeight,
          (n) => `${n} px`,
          (n) => set("mapHeight", n),
        )}
        <SwitchRow
          label="Pins in your accent colour"
          value={options.pinColor}
          onChange={(next) => set("pinColor", next)}
        />
      </>
    ) : (
      <>
        {choices(
          "Columns",
          ["2", "3", "4"] as const,
          options.columns,
          (n) => `${n} across`,
          (n) => set("columns", n),
        )}
        {choices(
          "Show at most",
          ["12", "24", "60"] as const,
          options.limit,
          (n) => `${n} projects`,
          (n) => set("limit", n),
        )}
        <SwitchRow
          label="Service filters"
          value={options.filters}
          onChange={(next) => set("filters", next)}
        />
      </>
    );

  const snippetBox = (text: string) => (
    <View
      style={{
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: theme.colors.secondary,
      }}
    >
      <Text variant="caption" selectable style={{ fontFamily: "monospace" }}>
        {text}
      </Text>
    </View>
  );

  const shareButton = (kind: "gallery" | "map", fullWidth: boolean) => (
    <Button
      label="Share the snippet"
      icon={Share2}
      fullWidth={fullWidth}
      onPress={() =>
        void openShareSheet(
          kind === "map" ? map : gallery,
          kind === "map" ? "Everlumen map embed" : "Everlumen gallery embed",
        )
      }
    />
  );

  const intro = (
    <Text variant="caption" tone="muted">
      Put your work on the website you already have. Pick one, then share the snippet with whoever
      looks after your website.
    </Text>
  );

  const rotateRow = (
    <>
      {note ? <Text variant="caption">{note}</Text> : null}
      <View style={{ alignItems: rail ? "flex-end" : "flex-start" }}>
        <Button
          label="Rotate embed key"
          icon={RefreshCw}
          size="sm"
          variant="ghost"
          disabled={busy}
          onPress={rotate}
        />
      </View>
    </>
  );

  if (sideBySide) {
    const panel = (kind: "gallery" | "map") => (
      <View style={{ flex: 1, minWidth: 0 }}>
        <Card>
          <View style={{ gap: spacing.md }}>
            <View style={{ gap: 2 }}>
              <Text variant="bodyStrong" accessibilityRole="header">
                {kind === "map" ? "Project map" : "Website gallery"}
              </Text>
              <Text variant="caption" tone="muted">
                {kind === "map"
                  ? "A map of where you have worked."
                  : "Best on an Our work or Gallery page."}
              </Text>
            </View>
            {embedOptions(kind)}
            {snippetBox(kind === "map" ? map : gallery)}
            <View style={{ alignItems: "flex-end" }}>{shareButton(kind, false)}</View>
          </View>
        </Card>
      </View>
    );
    return (
      <View style={{ gap: spacing.md }}>
        {intro}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
          {panel("gallery")}
          {panel("map")}
        </View>
        {rotateRow}
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      {intro}
      <ListGroup>
        <ListRow
          icon={Grid3x3}
          title="Website gallery"
          subtitle="A grid of your projects, filterable by service."
          onPress={() => setOpen("gallery")}
        />
        <RowDivider />
        <ListRow
          icon={MapPin}
          title="Project map"
          subtitle="One pin per published project."
          onPress={() => setOpen("map")}
        />
      </ListGroup>

      {rotateRow}

      <Sheet
        visible={open !== null}
        onClose={() => setOpen(null)}
        title={open === "map" ? "Project map" : "Website gallery"}
        subtitle={
          open === "map"
            ? "A map of where you have worked."
            : "Best on an Our work or Gallery page."
        }
        footer={
          <View style={{ alignItems: rail ? "flex-end" : "stretch" }}>
            {shareButton(open === "map" ? "map" : "gallery", !rail)}
          </View>
        }
      >
        {embedOptions(open === "map" ? "map" : "gallery")}
        {snippetBox(snippet)}
      </Sheet>
    </View>
  );
}
