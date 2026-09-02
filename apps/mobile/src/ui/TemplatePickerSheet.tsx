import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createPageFromTemplate,
  listDocumentTemplates,
  previewDocumentTemplate,
  type DocumentPageSummary,
  type DocumentTemplate,
} from "@/api/pages";
import {
  createBlocker,
  fieldSummary,
  groupTemplates,
  templateEditability,
  unresolvedFields,
} from "@/api/template-picker-view";
import { spacing } from "@/theme";
import { LayoutTemplate, TriangleAlert } from "@/ui/icons";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card, SectionHeader } from "./Card";
import { Field } from "./Field";
import { Icon } from "./Icon";
import { ListGroup, ListRow, RowDivider } from "./ListRow";
import { Sheet } from "./Sheet";
import { EmptyState, ErrorState, SkeletonList } from "./State";
import { Text } from "./Text";

/**
 * Start a document from one of the company's templates.
 *
 * Two steps, because the second cannot honestly be skipped. Picking a template
 * is a list; what happens next depends on the template, and the person has to
 * be told before a document exists rather than after:
 *
 *   - which merge tokens this job already answers, and which they must type
 *   - whether the result will be editable on the phone at all
 *
 * That second point is why this feature was once argued against. A document
 * built from a seeded template is rich HTML and the phone editor refuses to
 * rebuild it, so the page is read-only here. But read-only still means
 * appendable, shareable and exportable as a PDF, which is the whole of what a
 * handover certificate is for on site. The problem was never the limitation, it
 * was finding out afterwards.
 */
export function TemplatePickerSheet({
  visible,
  projectId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (page: DocumentPageSummary) => void;
}) {
  const [chosen, setChosen] = useState<DocumentTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: ["document-templates"],
    queryFn: listDocumentTemplates,
    enabled: visible,
    staleTime: 5 * 60 * 1000,
  });

  const preview = useQuery({
    queryKey: ["template-preview", chosen?.id, projectId],
    queryFn: () => previewDocumentTemplate({ templateId: chosen!.id, projectId }),
    enabled: visible && Boolean(chosen),
  });

  /*
   * The suggested title arrives with the preview and seeds the field once per
   * template. Seeding on every render would fight anybody typing into it.
   */
  const suggested = preview.data?.suggestedTitle ?? "";
  if (suggested && chosen && seededFor !== chosen.id) {
    setSeededFor(chosen.id);
    setTitle(suggested);
  }

  const groups = useMemo(() => groupTemplates(templates.data ?? []), [templates.data]);
  const fields = useMemo(() => preview.data?.fields ?? [], [preview.data]);
  const toType = useMemo(() => unresolvedFields(fields), [fields]);
  const editability = useMemo(
    () => (preview.data ? templateEditability(preview.data.html) : null),
    [preview.data],
  );

  const reset = useCallback(() => {
    setChosen(null);
    setTitle("");
    setValues({});
    setSeededFor(null);
    setFailure(null);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const create = useMutation({
    mutationFn: () =>
      createPageFromTemplate({
        projectId,
        templateId: chosen!.id,
        title: title.trim(),
        values,
      }),
    onSuccess: (page) => {
      reset();
      onCreated(page);
    },
    onError: (e: unknown) =>
      setFailure(e instanceof Error ? e.message : "That document could not be created."),
  });

  const blocker = createBlocker(title);

  return (
    <Sheet visible={visible} onClose={close} title={chosen ? chosen.name : "Start from a template"}>
      {!chosen ? (
        templates.isLoading ? (
          <SkeletonList rows={5} />
        ) : templates.error ? (
          <ErrorState
            title="Could not load the templates"
            message={templates.error instanceof Error ? templates.error.message : undefined}
            onRetry={() => void templates.refetch()}
          />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title="No templates yet"
            body="Templates are written on the web. Once your team saves one it appears here, ready to use on site."
          />
        ) : (
          <View style={{ gap: spacing.md }}>
            {groups.map((group) => (
              <View key={group.category}>
                <SectionHeader title={group.category} count={group.templates.length} />
                <ListGroup>
                  {group.templates.map((template, index) => (
                    <View key={template.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={LayoutTemplate}
                        title={template.name}
                        subtitle={template.description ?? undefined}
                        onPress={() => setChosen(template)}
                      />
                    </View>
                  ))}
                </ListGroup>
              </View>
            ))}
          </View>
        )
      ) : preview.isLoading ? (
        <SkeletonList rows={4} />
      ) : preview.error ? (
        <ErrorState
          title="Could not read that template"
          message={preview.error instanceof Error ? preview.error.message : undefined}
          onRetry={() => void preview.refetch()}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          <Field label="Name" value={title} onChangeText={setTitle} returnKeyType="done" />

          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text variant="caption" tone="muted">
              {fieldSummary(fields)}
            </Text>
            {chosen.isExample ? <Badge label="Built-in" variant="soft" /> : null}
          </View>

          {/*
            Only the tokens nothing could fill. Showing a resolved one as an
            empty box invites somebody to retype the site address that was
            already correct.
          */}
          {toType.map((field) => (
            <Field
              key={field.token}
              label={field.label}
              value={values[field.token] ?? ""}
              onChangeText={(next) => setValues((v) => ({ ...v, [field.token]: next }))}
            />
          ))}

          {editability && !editability.editable ? (
            <Card>
              <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
                <Icon icon={TriangleAlert} size="md" tone="safety" />
                <Text variant="body" tone="muted" style={{ flex: 1 }}>
                  {editability.because}
                </Text>
              </View>
            </Card>
          ) : null}

          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}

          <Button
            label={create.isPending ? "Creating" : "Create the document"}
            /*
             * The only guard against a double tap. `createPageFromTemplate` is
             * registered with plain `authed(...)` and no `{ idempotent: true }`,
             * so the server does not dedupe it: a second press would file a
             * second certificate.
             */
            disabled={create.isPending || Boolean(blocker)}
            fullWidth
            onPress={() => create.mutate()}
          />
          {blocker ? (
            <Text variant="caption" tone="muted">
              {blocker}
            </Text>
          ) : null}

          <Button label="Choose a different template" variant="ghost" onPress={reset} />
        </View>
      )}
    </Sheet>
  );
}
