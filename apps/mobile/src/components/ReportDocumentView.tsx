import { useState, type ReactNode } from "react";
import { View } from "react-native";
import type { InlineRun, RichBlock } from "@everlumen/shared";
import type { ReportDoc, ReportDocCompany, ReportDocPhoto } from "@/api/report-document";
import { radius, spacing, useTheme } from "@/theme";
import { Calendar, MapPin } from "@/ui/icons";
import { Icon, PhotoThumb, Text } from "@/ui";

/** From this inner page width a photo and its caption sit side by side, as on the web. */
const SIDE_BY_SIDE_MIN = 520;

/**
 * A finished report, drawn the way the client's page draws it.
 *
 * The phone's counterpart of the web's `ReportDocument`: the cover (letterhead,
 * "Project report", the title, who prepared it, the date, how many photos, the
 * project and its address, the cover photos), then each section page with its
 * heading, text and captioned photos. Read only. Editing is a separate screen
 * so reading a report is never one stray tap away from changing it.
 */
export function ReportDocumentView({ doc }: { doc: ReportDoc }) {
  const theme = useTheme();
  return (
    <View style={{ gap: spacing.lg }}>
      {doc.cover.enabled ? <CoverPage doc={doc} /> : null}
      {doc.pages.length === 0 ? (
        <Page>
          <Letterhead company={doc.company} small />
          <View style={{ paddingVertical: spacing.xxl, alignItems: "center" }}>
            <Text variant="body" tone="muted" align="center">
              This report has no sections yet.
            </Text>
          </View>
        </Page>
      ) : (
        doc.pages.map((page) => (
          <Page key={page.key}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                gap: spacing.md,
                paddingBottom: spacing.sm,
                marginBottom: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Text variant="overline" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                {doc.title.toUpperCase()}
              </Text>
              <Text variant="overline" tone="muted">
                SECTION {page.sectionIndex + 1} OF {doc.sectionCount}
              </Text>
            </View>
            {page.title ? (
              <Text variant="title" style={{ marginBottom: spacing.md }}>
                {page.title}
              </Text>
            ) : null}
            {page.blocks.length > 0 ? (
              <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
                {page.blocks.map((block, index) => (
                  <RichBlockView key={index} block={block} />
                ))}
              </View>
            ) : null}
            {page.photos.length > 0 ? <PhotoList photos={page.photos} /> : null}
          </Page>
        ))
      )}
    </View>
  );
}

/** One printed page: a white sheet with a soft edge. */
function Page({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.xl,
      }}
    >
      {children}
      <Text
        variant="caption"
        tone="muted"
        align="center"
        style={{ marginTop: spacing.xl, fontSize: 11 }}
      >
        Generated with Everlumen
      </Text>
    </View>
  );
}

function CoverPage({ doc }: { doc: ReportDoc }) {
  const theme = useTheme();
  const { cover } = doc;
  const stats: Array<{ label: string; value: string; icon?: typeof Calendar }> = [];
  if (cover.authorName) stats.push({ label: "PREPARED BY", value: cover.authorName });
  if (cover.dateLabel) stats.push({ label: "DATE", value: cover.dateLabel, icon: Calendar });
  stats.push({ label: "PHOTOS", value: `${doc.photoCount} included` });

  return (
    <Page>
      <Letterhead company={doc.company} />
      <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: spacing.lg }} />

      <View style={{ alignItems: "center", gap: spacing.md }}>
        <Text
          variant="overline"
          tone="primary"
          style={{ letterSpacing: 2.4, fontWeight: "700" }}
        >
          PROJECT REPORT
        </Text>
        <Text variant="title" align="center" style={{ fontSize: 26, lineHeight: 32 }}>
          {doc.title}
        </Text>
        {doc.subtitle ? (
          <Text variant="body" tone="muted" align="center">
            {doc.subtitle}
          </Text>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            columnGap: spacing.xl,
            rowGap: spacing.md,
            marginTop: spacing.sm,
          }}
        >
          {stats.map((stat) => (
            <View key={stat.label} style={{ alignItems: "center", gap: 2 }}>
              <Text variant="overline" tone="muted" style={{ fontSize: 10 }}>
                {stat.label}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {stat.icon ? <Icon icon={stat.icon} size="xs" tone="muted" /> : null}
                <Text variant="bodyStrong">{stat.value}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {cover.projectName ? (
        <View
          style={{
            marginTop: spacing.xl,
            padding: spacing.lg,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.background,
            alignItems: "center",
            gap: 4,
          }}
        >
          <Text variant="overline" tone="primary" style={{ fontSize: 10 }}>
            PROJECT
          </Text>
          <Text variant="heading" align="center">
            {cover.projectName}
          </Text>
          {cover.address ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon icon={MapPin} size="xs" tone="muted" />
              <Text variant="caption" tone="muted" align="center">
                {cover.address}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {cover.photos.length > 0 ? (
        <View
          style={{
            marginTop: spacing.xl,
            flexDirection: "row",
            flexWrap: "wrap",
            gap: spacing.sm,
          }}
        >
          {cover.photos.map((photo) => (
            <View
              key={photo.photoId}
              style={{
                width: cover.photos.length === 1 ? "100%" : "48.5%",
                aspectRatio: 4 / 3,
              }}
            >
              <PhotoThumb uri={photo.uri} width="100%" height="100%" rounded={radius.md} />
            </View>
          ))}
        </View>
      ) : null}
    </Page>
  );
}

/** The company's name, logo, phone and address, as the top of every web page. */
function Letterhead({ company, small = false }: { company: ReportDocCompany | null; small?: boolean }) {
  const name = company?.name?.trim() || "Everlumen";
  const logo = small ? 32 : 44;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      {company?.logoUrl ? (
        <PhotoThumb
          uri={company.logoUrl}
          width={logo}
          height={logo}
          rounded={radius.sm}
          contentFit="contain"
        />
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant={small ? "bodyStrong" : "heading"} numberOfLines={2}>
          {name}
        </Text>
        {!small && company?.phone ? (
          <Text variant="caption" tone="muted">
            {company.phone}
          </Text>
        ) : null}
        {!small && company?.address ? (
          <Text variant="caption" tone="muted">
            {company.address}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Captioned photos: side by side on a wide page, stacked on a phone. */
function PhotoList({ photos }: { photos: ReportDocPhoto[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const sideBySide = width >= SIDE_BY_SIDE_MIN;

  return (
    <View
      style={{ gap: spacing.md }}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
    >
      {photos.map((photo) => (
        <View
          key={photo.photoId}
          style={{
            flexDirection: sideBySide ? "row" : "column",
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            overflow: "hidden",
          }}
        >
          <View style={{ flex: sideBySide ? 3 : undefined, aspectRatio: 4 / 3 }}>
            <PhotoThumb uri={photo.uri} width="100%" height="100%" rounded={0} />
          </View>
          <View
            style={{
              flex: sideBySide ? 2 : undefined,
              justifyContent: "center",
              padding: spacing.md,
              backgroundColor: theme.colors.background,
              borderLeftWidth: sideBySide ? 1 : 0,
              borderTopWidth: sideBySide ? 0 : 1,
              borderColor: theme.colors.border,
            }}
          >
            {photo.caption ? (
              <Text variant="bodyStrong">{photo.caption}</Text>
            ) : (
              <Text variant="caption" tone="muted" style={{ fontStyle: "italic" }}>
                No caption
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((run, index) => (
        <Text
          key={index}
          style={{
            fontWeight: run.bold ? "700" : undefined,
            fontStyle: run.italic ? "italic" : undefined,
          }}
        >
          {run.text}
        </Text>
      ))}
    </>
  );
}

function RichBlockView({ block }: { block: RichBlock }) {
  if (block.type === "pageBreak") return null;
  if (block.type === "heading") {
    return (
      <Text variant={block.level === 1 ? "title" : "heading"} style={{ marginTop: spacing.xs }}>
        <Runs runs={block.runs} />
      </Text>
    );
  }
  if (block.type === "paragraph") {
    return (
      <Text variant="body">
        <Runs runs={block.runs} />
      </Text>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      {block.items.map((item, index) => (
        <View key={index} style={{ flexDirection: "row", gap: spacing.sm }}>
          <Text variant="body" tone="muted" style={{ minWidth: 18 }}>
            {block.ordered ? `${index + 1}.` : "•"}
          </Text>
          <Text variant="body" style={{ flex: 1 }}>
            <Runs runs={item} />
          </Text>
        </View>
      ))}
    </View>
  );
}
