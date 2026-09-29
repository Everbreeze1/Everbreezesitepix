import { useEffect, useState } from "react";
import { View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyProfile, saveMyProfile, uploadMyAvatar } from "@/api/profile";
import { useAuth } from "@/lib/auth";
import { spacing } from "@/theme";
import { Camera, CircleCheck, KeyRound } from "@/ui/icons";
import {
  Avatar,
  Button,
  ErrorState,
  Field,
  ListGroup,
  ListRow,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Your profile: the name and face the rest of the team sees.
 *
 * The web Settings page's Profile section. The name is what teammates see on
 * tasks, comments and the activity feed; the job title is merged into reports
 * as {{job_title}}; the avatar is the circle beside all of it. Changing any of
 * them here changes them on the web, because both write the same profile row.
 */
export default function ProfileScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: () => getMyProfile(user!.id),
    enabled: Boolean(user?.id),
  });

  // Seed the fields once the row arrives, and again after a save refetches it.
  useEffect(() => {
    if (!query.data) return;
    setFullName(query.data.full_name ?? "");
    setJobTitle(query.data.job_title ?? "");
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      saveMyProfile({
        userId: user!.id,
        email: user?.email ?? null,
        fullName,
        jobTitle,
      }),
    onMutate: () => {
      setError(null);
      setSaved(false);
    },
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      await queryClient.invalidateQueries({ queryKey: ["my-team"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save your profile"),
  });

  const avatar = useMutation({
    mutationFn: async () => {
      const granted = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!granted.granted) {
        throw new Error("Photo library permission is needed to choose a picture.");
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result.canceled || !result.assets[0]) return null;
      return uploadMyAvatar(user!.id, result.assets[0].uri);
    },
    onMutate: () => setError(null),
    onSuccess: async (url) => {
      if (!url) return;
      await queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      await queryClient.invalidateQueries({ queryKey: ["my-team"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not update your picture"),
  });

  if (query.isLoading) return <SkeletonList rows={4} />;
  if (query.error) {
    return (
      <ErrorState
        title="Could not load your profile"
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const profile = query.data;
  const dirty =
    fullName.trim() !== (profile?.full_name ?? "").trim() ||
    jobTitle.trim() !== (profile?.job_title ?? "").trim();

  return (
    <Screen scroll bottomInset={spacing.xxl}>
      <View style={{ alignItems: "center", gap: spacing.md, paddingTop: spacing.lg }}>
        <Avatar name={fullName || user?.email || null} uri={profile?.avatar_url} size="lg" />
        <Button
          label={profile?.avatar_url ? "Replace picture" : "Add a picture"}
          icon={Camera}
          variant="secondary"
          size="sm"
          loading={avatar.isPending}
          onPress={() => avatar.mutate()}
        />
      </View>

      <SectionHeader title="About you" />
      <View style={{ gap: spacing.md }}>
        <Field
          label="Full name"
          value={fullName}
          onChangeText={(next) => {
            setFullName(next);
            setSaved(false);
          }}
          placeholder="How your team sees you"
          autoCapitalize="words"
          autoComplete="name"
        />
        <Field
          label="Job title"
          value={jobTitle}
          onChangeText={(next) => {
            setJobTitle(next);
            setSaved(false);
          }}
          placeholder="Project manager, estimator"
          hint="Printed on reports that include your title."
          autoCapitalize="words"
        />
      </View>

      {error ? (
        <Text variant="caption" tone="destructive">
          {error}
        </Text>
      ) : null}
      {saved && !dirty ? (
        <Text variant="caption" tone="success">
          Profile saved.
        </Text>
      ) : null}

      <Button
        label="Save profile"
        icon={CircleCheck}
        fullWidth
        disabled={!dirty}
        loading={save.isPending}
        onPress={() => save.mutate()}
      />

      <SectionHeader title="Sign-in" />
      <ListGroup>
        <ListRow
          icon={KeyRound}
          title={user?.email ?? "Email"}
          subtitle="Change your email or password"
          onPress={() => router.push("/settings/security")}
        />
      </ListGroup>
    </Screen>
  );
}
