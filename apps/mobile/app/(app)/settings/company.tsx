import { useEffect, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCompanyProfile,
  getStorageUsed,
  getWebsite,
  saveCompanyDetails,
  setReportPhotosPerPage,
  setWatermarkEnabled,
  uploadCompanyLogo,
} from "@/api/company";
import {
  canUseWatermark,
  showsPlanDetails,
  storageSummary,
  watermarkNote,
  watermarkOn,
} from "@/api/company-view";
import type { PhotosPerPage } from "@/api/report-builder-view";
import { getMyTeam } from "@/api/team";
import { PhotosPerPagePicker } from "@/components/ReportControls";
import { SwitchRow } from "@/components/portfolio/SwitchRow";
import { useAuth } from "@/lib/auth";
import { radius, spacing, useLayout, useTheme } from "@/theme";
import { Building2, Globe, ImagePlus, MapPin, Phone, Save } from "@/ui/icons";
import {
  Button,
  Card,
  ErrorState,
  Field,
  ListGroup,
  ListRow,
  ProgressBar,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Company details and branding: the web Settings page's Company section.
 *
 * Everything here is the signed-in person's own profile, as on the web, so the
 * web's rule is the rule here: anybody can set their own company details and
 * logo, and those are what their reports carry. The watermark follows the
 * web's `canUseWatermark` (a Pro or Team workspace). Plan names and storage
 * allowances are shown to the account owner only; an invited member sees what
 * their own photos use and nothing about what the workspace pays for.
 */
export default function CompanySettingsScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const layout = useLayout();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const profileKey = ["company-profile", userId] as const;
  const profile = useQuery({
    queryKey: profileKey,
    queryFn: () => getCompanyProfile(userId!),
    enabled: Boolean(userId),
  });
  const team = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam, enabled: Boolean(userId) });
  const storage = useQuery({
    queryKey: ["storage-used", userId],
    queryFn: () => getStorageUsed(userId!),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
  const site = useQuery({
    queryKey: ["company-website", userId],
    queryFn: () => getWebsite(userId!),
    enabled: Boolean(userId),
  });

  // Seed the fields once both the row and the stored website have arrived.
  useEffect(() => {
    if (seeded || !profile.data || site.data === undefined) return;
    setCompany(profile.data.company ?? "");
    setPhone(profile.data.company_phone ?? "");
    setAddress(profile.data.company_address ?? "");
    setWebsite(site.data);
    setSeeded(true);
  }, [profile.data, site.data, seeded]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: profileKey });
    // Reports and the profile screen read the same row.
    await queryClient.invalidateQueries({ queryKey: ["my-profile"] });
  };

  const onError = (error: unknown) => {
    setNotice(null);
    setFailure(error instanceof Error ? error.message : "That did not save.");
  };

  const details = useMutation({
    mutationFn: () =>
      saveCompanyDetails({
        userId: userId!,
        email: user?.email ?? null,
        fields: { company, phone, address, website },
      }),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      setNotice("Company info saved");
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["company-website", userId] });
    },
    onError,
  });

  const logo = useMutation({
    mutationFn: async () => {
      const granted = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!granted.granted) {
        throw new Error("Photo library permission is needed to choose a logo.");
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return null;
      return uploadCompanyLogo(userId!, asset.uri, asset.width);
    },
    onMutate: () => setFailure(null),
    onSuccess: async (url) => {
      if (!url) return;
      setNotice("Logo updated");
      await refresh();
    },
    onError,
  });

  const watermark = useMutation({
    mutationFn: (on: boolean) => setWatermarkEnabled(userId!, on),
    onMutate: () => setFailure(null),
    onSuccess: async (_, on) => {
      setNotice(on ? "Watermark on" : "Watermark off");
      await refresh();
    },
    onError,
  });

  const perPage = useMutation({
    mutationFn: (n: PhotosPerPage) => setReportPhotosPerPage(userId!, n),
    onMutate: () => setFailure(null),
    onSuccess: async (_, n) => {
      setNotice(`New reports will use ${n} photo${n > 1 ? "s" : ""} per page`);
      await refresh();
    },
    onError,
  });

  if (profile.isLoading || !userId) {
    return (
      <>
        <Stack.Screen options={{ title: "Company" }} />
        <SkeletonList rows={6} />
      </>
    );
  }

  if (profile.error || !profile.data) {
    return (
      <>
        <Stack.Screen options={{ title: "Company" }} />
        <ErrorState
          title="Could not load your company details"
          message={profile.error instanceof Error ? profile.error.message : undefined}
          onRetry={() => void profile.refetch()}
        />
      </>
    );
  }

  const row = profile.data;
  const teamFacts = team.data ?? null;
  const owner = showsPlanDetails(teamFacts);
  const allowed = canUseWatermark(teamFacts);
  const hasLogo = Boolean(row.company_logo_url);
  const usage = storageSummary(storage.data ?? 0, teamFacts);
  const detailsDirty =
    company.trim() !== (row.company ?? "") ||
    phone.trim() !== (row.company_phone ?? "") ||
    address.trim() !== (row.company_address ?? "") ||
    website.trim() !== (site.data ?? "");
  const initial = (company || "?")[0]?.toUpperCase() ?? "?";

  return (
    <>
      <Stack.Screen options={{ title: "Company" }} />
      <Screen
        scroll
        refreshing={profile.isRefetching}
        onRefresh={() => {
          setSeeded(false);
          void profile.refetch();
          void storage.refetch();
          void site.refetch();
        }}
        bottomInset={spacing.xxl}
      >
        {failure ? (
          <Text variant="caption" tone="destructive">
            {failure}
          </Text>
        ) : notice ? (
          <Text variant="caption" tone="success">
            {notice}
          </Text>
        ) : null}

        <SectionHeader title="Logo" />
        <Card>
          <View
            style={{
              flexDirection: layout.landscape || layout.tablet ? "row" : "column",
              alignItems: layout.landscape || layout.tablet ? "center" : "flex-start",
              gap: spacing.lg,
            }}
          >
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: radius.lg,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.secondary,
              }}
            >
              {row.company_logo_url ? (
                <Image
                  source={{ uri: row.company_logo_url }}
                  style={{ width: 88, height: 88 }}
                  contentFit="contain"
                  accessibilityLabel="Company logo"
                />
              ) : (
                <Text variant="title" tone="primary">
                  {initial}
                </Text>
              )}
            </View>
            <View
              style={{ flex: layout.landscape || layout.tablet ? 1 : undefined, gap: spacing.md }}
            >
              <Text variant="caption" tone="muted">
                Shown in reports, shared galleries, and optional photo watermarks.
              </Text>
              <SwitchRow
                label="Watermark photos with logo"
                hint={watermarkNote({ allowed, hasLogo, owner })}
                value={watermarkOn(allowed, row.watermark_enabled)}
                disabled={!allowed || !hasLogo || watermark.isPending}
                onChange={(next) => watermark.mutate(next)}
              />
            </View>
            <Button
              label={hasLogo ? "Replace logo" : "Upload logo"}
              icon={ImagePlus}
              variant="secondary"
              size="sm"
              loading={logo.isPending}
              onPress={() => logo.mutate()}
            />
          </View>
        </Card>

        <SectionHeader title="Company details" />
        <View style={{ gap: spacing.md }}>
          <Field
            label="Company name"
            icon={Building2}
            value={company}
            onChangeText={setCompany}
            placeholder="Acme Construction"
            autoCapitalize="words"
          />
          <Field
            label="Business phone"
            icon={Phone}
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 555 123 4567"
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <Field
            label="Business address"
            icon={MapPin}
            value={address}
            onChangeText={setAddress}
            placeholder="123 Builder St, City, State 00000"
            autoComplete="street-address"
          />
          <Field
            label="Website"
            icon={Globe}
            value={website}
            onChangeText={setWebsite}
            placeholder="acme.com"
            keyboardType="url"
            autoCapitalize="none"
            hint="Kept on this device, as the web keeps it in the browser."
          />
          {/* The primary action sits on the right, on a phone and a tablet alike. */}
          <View style={{ alignItems: "flex-end" }}>
            <Button
              label="Save company info"
              icon={Save}
              loading={details.isPending}
              disabled={!seeded || !detailsDirty}
              onPress={() => details.mutate()}
            />
          </View>
        </View>

        <SectionHeader title="Report layout" />
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" tone="muted">
            How densely photos sit in a report. The default for every new report, including the one
            built for you when a walkthrough ends. Any single report can still be changed
            afterwards.
          </Text>
          <PhotosPerPagePicker
            value={row.report_photos_per_page}
            hint={false}
            onChange={(n) => {
              if (n !== row.report_photos_per_page) perPage.mutate(n);
            }}
          />
        </View>

        <SectionHeader title="Photo storage" />
        <View style={{ gap: spacing.sm }}>
          <Text variant="body">
            {storage.isLoading
              ? "Adding it up"
              : storage.error
                ? "Could not read storage"
                : usage.line}
          </Text>
          {usage.percent !== null && !storage.isLoading && !storage.error ? (
            <ProgressBar value={usage.percent} total={100} />
          ) : null}
        </View>

        <SectionHeader title="Elsewhere" />
        <ListGroup>
          <ListRow
            icon={Building2}
            title="Business profile"
            subtitle="Industry, trades and service area"
            onPress={() => router.push("/workspace")}
          />
        </ListGroup>
      </Screen>
    </>
  );
}
