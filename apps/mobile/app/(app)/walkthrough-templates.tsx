import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWalkthroughTemplate,
  loadWalkthroughLibrary,
} from "@/api/walkthrough-template-admin";
import {
  shotsFor,
  shotSummary,
  visibleWalkthroughTemplates,
} from "@/api/walkthrough-template-view";
import { templateNameError } from "@/api/template-edit";
import { GENERAL_CATEGORY, storedCategory, tradeOf } from "@/api/template-library-view";
import { getMyTeam } from "@/api/team";
import { canManageLibrary, errorText, TradeChips } from "@/components/TemplateLibraryParts";
import { spacing } from "@/theme";
import { Archive, Footprints, Plus } from "@/ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SearchField,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Walkthrough templates: named, ordered shot lists the crew works through on
 * site. The web's walkthrough library. Each opens on
 * `walkthrough-template/[id]`, where the shots are edited.
 */
export default function WalkthroughTemplatesScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTrade, setDraftTrade] = useState(GENERAL_CATEGORY);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const libraryQuery = useQuery({
    queryKey: ["walkthrough-templates-admin"],
    queryFn: loadWalkthroughLibrary,
  });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const canManage = canManageLibrary(teamQuery.data?.myRole, teamQuery.isSuccess);

  // Arriving from the Templates chooser opens the create sheet once.
  const { create: createParam } = useLocalSearchParams<{ create?: string }>();
  const autoOpened = useRef(false);
  useEffect(() => {
    if (createParam !== "1" || !canManage || autoOpened.current) return;
    autoOpened.current = true;
    setCreating(true);
  }, [createParam, canManage]);

  const library = libraryQuery.data;
  const templates = useMemo(() => (library?.status === "ok" ? library.templates : []), [library]);
  const shots = useMemo(() => (library?.status === "ok" ? library.shots : []), [library]);
  const visible = useMemo(
    () => visibleWalkthroughTemplates(templates, { showArchived, search }),
    [templates, showArchived, search],
  );
  const archivedCount = templates.filter((t) => t.archived).length;

  const create = useMutation({
    mutationFn: () =>
      createWalkthroughTemplate({
        name: draftName,
        description: draftDescription,
        category: storedCategory(draftTrade),
      }),
    onSuccess: async (id) => {
      await queryClient.refetchQueries({ queryKey: ["walkthrough-templates-admin"] });
      void queryClient.invalidateQueries({ queryKey: ["blueprint-library"] });
      setCreating(false);
      setDraftName("");
      setDraftDescription("");
      setDraftTrade(GENERAL_CATEGORY);
      router.push({ pathname: "/walkthrough-template/[id]", params: { id } });
    },
    onError: (error) => setFailure(errorText(error, "Could not create that walkthrough.")),
  });

  const submit = () => {
    const error = templateNameError(draftName);
    if (error) {
      setNameError(error);
      return;
    }
    setNameError(null);
    create.mutate();
  };

  const unavailable = library?.status === "unavailable";

  return (
    <>
      <Stack.Screen
        options={{
          title: "Walkthrough templates",
          headerRight: () =>
            canManage && !unavailable ? (
              <IconButton
                icon={Plus}
                accessibilityLabel="New walkthrough template"
                surface={false}
                tone="primary"
                disabled={create.isPending}
                onPress={() => setCreating(true)}
              />
            ) : null,
        }}
      />

      <Screen
        scroll
        padded={false}
        refreshing={libraryQuery.isRefetching}
        onRefresh={() => void libraryQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        {libraryQuery.isLoading ? (
          <SkeletonList rows={5} />
        ) : libraryQuery.error ? (
          <ErrorState
            title="Could not load walkthrough templates"
            message={errorText(libraryQuery.error, "")}
            onRetry={() => void libraryQuery.refetch()}
          />
        ) : unavailable ? (
          <View style={{ padding: spacing.lg }}>
            <EmptyState
              icon={Footprints}
              title="Not available on this workspace yet"
              body="This database cannot store walkthrough templates until an update is applied. Nothing is wrong with your account."
            />
          </View>
        ) : (
          <View style={{ paddingTop: spacing.lg, gap: spacing.md }}>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search walkthroughs"
              accessibilityLabel="Search walkthrough templates"
            />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
              {failure ? (
                <Text variant="caption" tone="destructive">
                  {failure}
                </Text>
              ) : null}
              {visible.length === 0 ? (
                <EmptyState
                  icon={Footprints}
                  title={templates.length ? "Nothing matches" : "No walkthrough templates yet"}
                  body={
                    templates.length
                      ? "Try another search."
                      : "A shot list the crew follows on site: what to capture, why, and which shots can be skipped."
                  }
                  action={
                    canManage && !templates.length
                      ? { label: "New walkthrough", onPress: () => setCreating(true), icon: Plus }
                      : undefined
                  }
                />
              ) : (
                <ListGroup>
                  {visible.map((template, index) => (
                    <View key={template.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={Footprints}
                        iconTone={template.archived ? "muted" : "primary"}
                        title={template.name}
                        subtitle={[
                          tradeOf(template.category),
                          shotSummary(shotsFor(shots, template.id)),
                        ].join(" · ")}
                        right={
                          template.archived ? (
                            <Badge label="Archived" tone="neutral" variant="outline" />
                          ) : undefined
                        }
                        onPress={() =>
                          router.push({
                            pathname: "/walkthrough-template/[id]",
                            params: { id: template.id },
                          })
                        }
                      />
                    </View>
                  ))}
                </ListGroup>
              )}
              {archivedCount > 0 ? (
                <Button
                  label={showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
                  icon={Archive}
                  variant="ghost"
                  fullWidth
                  onPress={() => setShowArchived((current) => !current)}
                />
              ) : null}
            </View>
          </View>
        )}
      </Screen>

      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="New walkthrough template"
        subtitle="Name it now and add the shots next."
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            value={draftName}
            onChangeText={(next) => {
              setDraftName(next);
              if (nameError) setNameError(null);
            }}
            placeholder="Pre-work site condition"
            error={nameError ?? undefined}
            autoCapitalize="sentences"
          />
          <Field
            label="Description"
            value={draftDescription}
            onChangeText={setDraftDescription}
            hint="Optional"
            multiline
            rows={2}
          />
          <TradeChips value={draftTrade} onChange={setDraftTrade} />
          <Button
            label="Save and open"
            icon={Plus}
            fullWidth
            loading={create.isPending}
            onPress={submit}
          />
        </View>
      </Sheet>
    </>
  );
}
