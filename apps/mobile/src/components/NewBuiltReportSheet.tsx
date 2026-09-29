import { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createBuiltReport,
  listSavedReportTemplates,
  reportStarters,
  type BuiltReport,
  type BuiltReportStart,
} from "@/api/report-builder";
import type { CoverOptions, PhotosPerPage } from "@/api/report-builder-view";
import { defaultReportTitle, reportTitleError } from "@/api/report-view";
import { spacing } from "@/theme";
import { Check, FileText, LayoutTemplate, Lock } from "@/ui/icons";
import {
  Badge,
  Button,
  Field,
  Icon,
  ListGroup,
  ListRow,
  RowDivider,
  SectionHeader,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";
import { PhotosPerPagePicker, ToggleRow } from "./ReportControls";

const FULL_COVER: CoverOptions = {
  cover_enabled: true,
  cover_show_project_name: true,
  cover_show_address: true,
  cover_show_date: true,
  cover_show_author: true,
};

/**
 * A new hand-built report, as the web's New report dialog makes one: a title,
 * a start (blank, a built-in starter, or one of the team's saved templates),
 * the cover page and the photos-per-page density. The starter seeds the
 * sections; everything stays editable in the report afterwards.
 *
 * Starters and saved templates are Pro and Team, as on the web. Locked ones
 * still show, with a padlock, because that is how a Starter workspace learns
 * the library exists.
 */
export function NewBuiltReportSheet({
  visible,
  projectId,
  projectName,
  templatesLocked,
  onClose,
  onCreated,
}: {
  visible: boolean;
  projectId: string;
  projectName: string;
  templatesLocked: boolean;
  onClose: () => void;
  onCreated: (report: BuiltReport) => void;
}) {
  const [title, setTitle] = useState(() => defaultReportTitle(projectName));
  const [titleError, setTitleError] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState("");
  const [start, setStart] = useState<BuiltReportStart>({ kind: "blank" });
  const [perPage, setPerPage] = useState<PhotosPerPage>(2);
  const [cover, setCover] = useState<CoverOptions>(FULL_COVER);
  const [failure, setFailure] = useState<string | null>(null);

  const saved = useQuery({
    queryKey: ["report-templates"],
    queryFn: listSavedReportTemplates,
    enabled: visible && !templatesLocked,
    staleTime: 5 * 60 * 1000,
  });

  const starterGroups = useMemo(() => {
    const groups = new Map<string, (typeof reportStarters)[number][]>();
    for (const starter of reportStarters) {
      groups.set(starter.category, [...(groups.get(starter.category) ?? []), starter]);
    }
    return Array.from(groups.entries());
  }, []);

  const create = useMutation({
    mutationFn: () =>
      createBuiltReport({
        projectId,
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        photosPerPage: perPage,
        cover,
        start,
      }),
    onSuccess: ({ report, warning }) => {
      if (warning) Alert.alert("Report created", warning);
      onCreated(report);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not create the report."),
  });

  const locked = () =>
    Alert.alert(
      "Templates are on Pro and Team",
      "Starter builds reports by hand, with every layout control still available.",
    );

  const isStarter = (id: string) => start.kind === "starter" && start.starter.id === id;
  const isSaved = (id: string) => start.kind === "saved" && start.template.id === id;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="New report"
      subtitle="Cover page and sections you fill in"
      maxHeightRatio={0.92}
      footer={
        <View style={{ gap: spacing.sm }}>
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
          <Button
            label="Create report"
            fullWidth
            loading={create.isPending}
            disabled={create.isPending}
            onPress={() => {
              const bad = reportTitleError(title);
              if (bad) {
                setTitleError(bad);
                return;
              }
              create.mutate();
            }}
          />
        </View>
      }
    >
      <View style={{ gap: spacing.md }}>
        <Field
          label="Title"
          value={title}
          onChangeText={(next) => {
            setTitle(next);
            if (titleError) setTitleError(null);
          }}
          error={titleError ?? undefined}
        />
        <Field
          label="Subtitle (optional)"
          value={subtitle}
          onChangeText={setSubtitle}
          placeholder="Shown under the title on the cover"
        />
        <PhotosPerPagePicker value={perPage} onChange={setPerPage} />

        <SectionHeader title="Cover page" />
        <ListGroup>
          <ToggleRow
            title="Cover page"
            value={cover.cover_enabled}
            onChange={(v) => setCover((c) => ({ ...c, cover_enabled: v }))}
          />
          {cover.cover_enabled ? (
            <>
              <RowDivider />
              <ToggleRow
                title="Project name"
                value={cover.cover_show_project_name}
                onChange={(v) => setCover((c) => ({ ...c, cover_show_project_name: v }))}
              />
              <RowDivider />
              <ToggleRow
                title="Address"
                value={cover.cover_show_address}
                onChange={(v) => setCover((c) => ({ ...c, cover_show_address: v }))}
              />
              <RowDivider />
              <ToggleRow
                title="Date"
                value={cover.cover_show_date}
                onChange={(v) => setCover((c) => ({ ...c, cover_show_date: v }))}
              />
              <RowDivider />
              <ToggleRow
                title="Author name"
                value={cover.cover_show_author}
                onChange={(v) => setCover((c) => ({ ...c, cover_show_author: v }))}
              />
            </>
          ) : null}
        </ListGroup>

        <SectionHeader title="Start from" />
        <ListGroup>
          <ListRow
            icon={FileText}
            title="Blank report"
            subtitle="No sections yet. Add them as you go."
            right={start.kind === "blank" ? <Icon icon={Check} size="md" tone="primary" /> : null}
            onPress={() => setStart({ kind: "blank" })}
          />
        </ListGroup>

        {templatesLocked ? null : saved.isLoading ? (
          <SkeletonList rows={2} />
        ) : (saved.data ?? []).length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="overline" tone="muted">
              YOUR TEAM&apos;S TEMPLATES
            </Text>
            <ListGroup>
              {(saved.data ?? []).map((template, i) => (
                <View key={template.id}>
                  {i > 0 ? <RowDivider /> : null}
                  <ListRow
                    icon={LayoutTemplate}
                    title={template.name}
                    subtitle={template.headings.slice(0, 4).join(", ")}
                    right={
                      isSaved(template.id) ? <Icon icon={Check} size="md" tone="primary" /> : null
                    }
                    onPress={() => {
                      setStart({ kind: "saved", template });
                      if (template.subtitle && !subtitle) setSubtitle(template.subtitle);
                    }}
                  />
                </View>
              ))}
            </ListGroup>
          </View>
        ) : null}

        {starterGroups.map(([category, starters]) => (
          <View key={category} style={{ gap: spacing.sm }}>
            <Text variant="overline" tone="muted">
              {category.toUpperCase()}
            </Text>
            <ListGroup>
              {starters.map((starter, i) => (
                <View key={starter.id}>
                  {i > 0 ? <RowDivider /> : null}
                  <ListRow
                    icon={templatesLocked ? Lock : LayoutTemplate}
                    iconTone={templatesLocked ? "muted" : "primary"}
                    title={starter.name}
                    subtitle={starter.description}
                    right={
                      templatesLocked ? (
                        <Badge label="Pro" tone="neutral" variant="outline" />
                      ) : isStarter(starter.id) ? (
                        <Icon icon={Check} size="md" tone="primary" />
                      ) : null
                    }
                    onPress={() => {
                      if (templatesLocked) {
                        locked();
                        return;
                      }
                      setStart({ kind: "starter", starter });
                      setPerPage(starter.photosPerPage);
                      setCover({
                        cover_enabled: starter.cover.enabled,
                        cover_show_project_name: starter.cover.showProjectName,
                        cover_show_address: starter.cover.showAddress,
                        cover_show_date: starter.cover.showDate,
                        cover_show_author: starter.cover.showAuthor,
                      });
                    }}
                  />
                </View>
              ))}
            </ListGroup>
          </View>
        ))}
      </View>
    </Sheet>
  );
}
