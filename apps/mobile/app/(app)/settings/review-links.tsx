import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyTeam } from "@/api/team";
import { listReviewLinks, setReviewLinks } from "@/api/review-links";
import {
  MAX_REVIEW_LINKS,
  REVIEW_PLATFORMS,
  blankDraft,
  cleanedLinks,
  draftsFrom,
  reviewLinkProblem,
  reviewLinksAllowed,
  reviewLinksChanged,
  reviewLinksLockedNote,
  type ReviewLinkDraft,
} from "@/api/review-links-view";
import { webAppLink } from "@/lib/api";
import { spacing } from "@/theme";
import { Check, CreditCard, Link, Plus, Star, Trash2 } from "@/ui/icons";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Screen,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Review links: the web Settings page's Review Links section, as its own
 * setting.
 *
 * Links to the company's Google Business Profile, NiceJob or any other review
 * site. They show as a "How did we do?" prompt on every shared report and Site
 * Log. The list is saved whole, as the web saves it, so Save sends every row.
 */
export default function ReviewLinksScreen() {
  const queryClient = useQueryClient();
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const allowed = reviewLinksAllowed(teamQuery.data);
  const isOwner = teamQuery.data?.myRole === "owner";

  const linksQuery = useQuery({
    queryKey: ["review-links"],
    queryFn: listReviewLinks,
    enabled: allowed,
  });

  const [drafts, setDrafts] = useState<ReviewLinkDraft[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (linksQuery.data) setDrafts(draftsFrom(linksQuery.data));
  }, [linksQuery.data]);

  const problems = drafts.map(reviewLinkProblem);
  const invalid = problems.some(Boolean);
  const changed = reviewLinksChanged(linksQuery.data ?? [], drafts);

  const save = useMutation({
    mutationFn: () => setReviewLinks(cleanedLinks(drafts)),
    onMutate: () => setNote(null),
    onSuccess: (links) => {
      queryClient.setQueryData(["review-links"], links);
      setNote({ ok: true, text: "Review links saved." });
    },
    onError: (e: unknown) =>
      setNote({ ok: false, text: e instanceof Error ? e.message : "Failed to save review links" }),
  });

  const update = (index: number, patch: Partial<ReviewLinkDraft>) => {
    setNote(null);
    setDrafts((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  /** A row with a link in it asks first; its removal is saved with the rest. */
  const remove = (index: number) => {
    const drop = () => setDrafts((rows) => rows.filter((_, i) => i !== index));
    if (!drafts[index]?.url.trim()) {
      drop();
      return;
    }
    Alert.alert("Remove this link?", "It comes off your reports when you save.", [
      { text: "Keep it", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: drop },
    ]);
  };

  const canSave = allowed && changed && !invalid && !save.isPending;

  // Adding sits in the header, where it stays in reach however long the list gets.
  const header = (
    <Stack.Screen
      options={{
        title: "Review links",
        headerRight:
          allowed && !linksQuery.isLoading
            ? () => (
                <IconButton
                  icon={Plus}
                  accessibilityLabel="Add a review link"
                  surface={false}
                  tone="primary"
                  disabled={drafts.length >= MAX_REVIEW_LINKS}
                  onPress={() => setDrafts((rows) => [...rows, blankDraft()])}
                />
              )
            : undefined,
      }}
    />
  );

  if (teamQuery.isLoading || (allowed && linksQuery.isLoading)) {
    return (
      <>
        {header}
        <SkeletonList rows={3} />
      </>
    );
  }

  if (teamQuery.error || linksQuery.error) {
    const error = teamQuery.error ?? linksQuery.error;
    return (
      <>
        {header}
        <ErrorState
          title="Could not load your review links"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void (teamQuery.error ? teamQuery.refetch() : linksQuery.refetch())}
        />
      </>
    );
  }

  if (!allowed) {
    const pricing = webAppLink("/pricing");
    return (
      <>
        {header}
        <EmptyState
          icon={Star}
          title="Review links"
          body={reviewLinksLockedNote(isOwner)}
          action={
            isOwner && pricing
              ? {
                  label: "See plans",
                  icon: CreditCard,
                  onPress: () => void WebBrowser.openBrowserAsync(pricing),
                }
              : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <Screen scroll bottomInset={spacing.xxl}>
        <View style={{ gap: spacing.lg, paddingTop: spacing.lg }}>
          <Text variant="body" tone="muted">
            Add links to your Google Business Profile, NiceJob, or any other review site. They show
            up as a "How did we do?" prompt on every shared report and Site Log.
          </Text>
          <Text variant="caption" tone="muted">
            Connecting your Google Business Profile from Portfolio fills the Google link in for you.
          </Text>

          {drafts.map((row, index) => (
            <Card key={index} style={{ gap: spacing.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {REVIEW_PLATFORMS.map((p) => (
                    <Chip
                      key={p.id}
                      label={p.label}
                      selected={row.platform === p.id}
                      onPress={() => update(index, { platform: p.id })}
                    />
                  ))}
                </View>
                <IconButton
                  icon={Trash2}
                  accessibilityLabel="Remove this link"
                  surface={false}
                  tone="destructive"
                  onPress={() => remove(index)}
                />
              </View>
              {row.platform === "custom" ? (
                <Field
                  label="Label"
                  value={row.label}
                  onChangeText={(v) => update(index, { label: v })}
                  placeholder="Yelp"
                  autoCapitalize="words"
                />
              ) : null}
              <Field
                label="Link"
                icon={Link}
                value={row.url}
                onChangeText={(v) => update(index, { url: v })}
                placeholder="https://..."
                keyboardType="url"
                autoCapitalize="none"
                error={problems[index] ?? undefined}
              />
            </Card>
          ))}

          {drafts.length === 0 ? (
            <Text variant="body" tone="muted">
              No review links yet. Add one with the plus at the top.
            </Text>
          ) : null}

          {note ? (
            <Text variant="caption" tone={note.ok ? "success" : "destructive"}>
              {note.text}
            </Text>
          ) : null}

          <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end" }}>
            <Button
              label={save.isPending ? "Saving" : "Save"}
              icon={Check}
              loading={save.isPending}
              disabled={!canSave}
              onPress={() => save.mutate()}
            />
          </View>
        </View>
      </Screen>
    </>
  );
}
