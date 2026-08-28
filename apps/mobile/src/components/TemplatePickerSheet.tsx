import { useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { TemplateSummary } from "@/api/templates";
import { spacing } from "@/theme";
import { LayoutTemplate } from "@/ui/icons";
import {
  Button,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  RowDivider,
  SearchField,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Pick a template to start on this project.
 *
 * One component for checklists and workflows: the two lists are the same shape
 * and the difference is entirely in what the caller does with the choice.
 *
 * The offline notice is the honest part. Applying a template writes across two
 * or three tables in an order the database enforces, so unlike every other
 * write in this app it cannot be queued. Saying that up front is better than
 * letting someone tap a template in a basement and find nothing happened.
 */
export function TemplatePickerSheet({
  visible,
  onClose,
  title,
  subtitle,
  load,
  onPick,
  applying = false,
  error,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Query key and fetcher for the template list. */
  load: { key: string; fetch: () => Promise<TemplateSummary[]> };
  onPick: (template: TemplateSummary) => void;
  applying?: boolean;
  /** Message from a failed apply, shown in place rather than as a toast. */
  error?: string | null;
}) {
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: [load.key],
    queryFn: load.fetch,
    enabled: visible,
    // Templates are workspace configuration and change rarely.
    staleTime: 10 * 60 * 1000,
  });

  const templates = useMemo(() => {
    const all = query.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        (t.description ?? "").toLowerCase().includes(needle),
    );
  }, [query.data, search]);

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      {error ? (
        <Text variant="caption" tone="destructive">
          {error}
        </Text>
      ) : null}

      {query.isLoading ? (
        <SkeletonList rows={5} />
      ) : query.error ? (
        <ErrorState
          /*
           * Almost always a connection problem, and this is the one action in
           * the app that genuinely needs one, so the offline wording is the
           * likelier truth rather than a guess.
           */
          title="Could not load templates"
          message={
            query.error instanceof Error
              ? query.error.message
              : "Templates need a connection, because starting one writes several linked rows at once."
          }
          onRetry={() => void query.refetch()}
        />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No templates yet"
          body="Templates are set up once for the workspace, then started on any job."
        />
      ) : (
        <>
          {(query.data ?? []).length > 6 ? (
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search templates"
              accessibilityLabel="Search templates"
            />
          ) : null}

          {templates.length === 0 ? (
            <Text variant="body" tone="muted">
              Nothing matches that search.
            </Text>
          ) : (
            <ListGroup>
              {templates.map((template, index) => (
                <View key={template.id}>
                  {index === 0 ? null : <RowDivider inset={false} />}
                  <ListRow
                    title={template.name}
                    subtitle={template.description ?? template.category ?? undefined}
                    disabled={applying}
                    onPress={() => onPick(template)}
                  />
                </View>
              ))}
            </ListGroup>
          )}

          <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
            Starting a template needs a connection. Everything you do inside it afterwards works
            offline as usual.
          </Text>
        </>
      )}

      {applying ? <Button label="Starting" fullWidth loading disabled onPress={() => {}} /> : null}
    </Sheet>
  );
}
