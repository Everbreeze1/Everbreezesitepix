import { useMemo } from "react";
import { ActivityIndicator, Alert, Share, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Svg, { Path, Rect } from "react-native-svg";
import { projectDisplayName } from "@everlumen/shared";
import { formatAddress, getProject } from "@/api/projects";
import {
  ensureProjectShareState,
  isShareLive,
  publicUrl,
  setProjectShareEnabled,
} from "@/api/sharing";
import { encodeQr, qrDisplaySide, qrPath } from "@/lib/qr";
import { radius, spacing, useLayout, useTheme } from "@/theme";
import { Globe, Link2, QrCode, RefreshCw, Share2 } from "@/ui/icons";
import { Button, Card, ErrorState, Icon, Screen, Text } from "@/ui";

/**
 * The job's QR code, big enough to scan off the phone's own screen.
 *
 * The web's `ProjectQrDialog`, for a phone: the code encodes the project's
 * PUBLIC link (`/share/projects/<token>`), so whoever scans it (the homeowner,
 * the inspector, the sub) reads the job's photos with no account. Opening this
 * screen is what publishes the link the first time, through the same
 * `ensureProjectShare` op; after that the switch is the owner's alone and
 * looking at the code never turns it back on.
 *
 * Level Q, as on the web: these get printed and taped up outside, and the link
 * is short enough that the extra redundancy costs nothing a camera notices.
 *
 * What the phone does not do is the web's "Save PNG" and "Print sheet": there
 * is no image-capture or print module in this build. Share sends the link,
 * which is what a customer standing next to the tech actually needs.
 */
export default function ProjectQrScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const layout = useLayout();
  const queryClient = useQueryClient();
  const sideBySide = layout.spread;

  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
  });
  const project = projectQuery.data ?? null;
  const name = project ? projectDisplayName(project) : "";
  const address = project ? formatAddress(project) : null;

  const shareQuery = useQuery({
    queryKey: ["project-qr-share", id],
    queryFn: () => ensureProjectShareState(String(id)),
    enabled: Boolean(id),
    // The share state is small and the point of the screen; never serve it stale.
    staleTime: 0,
  });

  const token = shareQuery.data?.shareToken ?? null;
  const live = isShareLive(token, shareQuery.data?.revokedAt ?? null);
  const url = publicUrl("projects", token);

  const code = useMemo(() => {
    if (!url) return null;
    try {
      return encodeQr(url, "Q");
    } catch {
      return null;
    }
  }, [url]);

  const toggle = useMutation({
    mutationFn: (enable: boolean) => setProjectShareEnabled(String(id), enable),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-qr-share", id] });
      void queryClient.invalidateQueries({ queryKey: ["project-share", id] });
    },
    onError: (error: unknown) =>
      Alert.alert(
        "Could not change the link",
        error instanceof Error ? error.message : "Please try again.",
      ),
  });

  async function share() {
    if (!url) return;
    try {
      await Share.share({ message: url, title: name || "Project" });
    } catch {
      // Dismissing the share sheet is not a failure.
    }
  }

  function turnOff() {
    Alert.alert(
      "Turn the link off?",
      "The printed code stops working, and anyone holding the link loses access to the photos. Turning it back on gives out the same link again.",
      [
        { text: "Keep it on", style: "cancel" },
        { text: "Turn off", style: "destructive", onPress: () => toggle.mutate(false) },
      ],
    );
  }

  const side = qrDisplaySide(layout.width, layout.height, sideBySide);

  const qr = (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={name ? `QR code linking to ${name}` : "QR code for this job"}
      style={{
        width: side,
        height: side,
        alignSelf: "center",
        borderRadius: radius.lg,
        // Always black on white, whatever the theme: a scanner wants contrast,
        // and a dark-mode inverted code fails on many phone cameras.
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {shareQuery.isLoading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : code ? (
        <View style={{ opacity: live ? 1 : 0.25 }}>
          <Svg width={side - 2} height={side - 2} viewBox={`0 0 ${code.size + 8} ${code.size + 8}`}>
            <Rect x={0} y={0} width={code.size + 8} height={code.size + 8} fill="#ffffff" />
            <Path d={qrPath(code)} fill="#000000" />
          </Svg>
        </View>
      ) : (
        <Icon icon={QrCode} size="xl" tone="muted" />
      )}
    </View>
  );

  const controls = shareQuery.error ? (
    <ErrorState
      message={
        shareQuery.error instanceof Error
          ? shareQuery.error.message
          : "Could not load the public link"
      }
      onRetry={() => void shareQuery.refetch()}
    />
  ) : (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <Text variant="title">{name || "This job"}</Text>
        {address ? (
          <Text variant="caption" tone="muted">
            {address}
          </Text>
        ) : null}
      </View>

      {shareQuery.isLoading ? null : !url ? (
        <Text variant="body" tone="muted">
          Sharing is not set up for this workspace, so there is no link to put in a code.
        </Text>
      ) : live ? (
        <>
          <Card style={{ gap: spacing.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Icon icon={Globe} size="md" tone="primary" />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                Anyone can scan it
              </Text>
            </View>
            <Text variant="caption" tone="muted">
              Scanning opens this job&apos;s name, address and photos in any browser. No app, no
              account, and nothing they can change.
            </Text>
            <Text variant="caption" tone="muted" selectable numberOfLines={2}>
              {url}
            </Text>
          </Card>
          <Button label="Send link" icon={Share2} fullWidth onPress={() => void share()} />
          <Button
            label="Turn the link off"
            icon={Link2}
            variant="outline"
            fullWidth
            loading={toggle.isPending}
            disabled={toggle.isPending}
            onPress={turnOff}
          />
        </>
      ) : (
        <>
          <Text variant="body" tone="muted">
            The link is off, so this code leads nowhere.
          </Text>
          <Button
            label="Turn the link on"
            icon={RefreshCw}
            fullWidth
            loading={toggle.isPending}
            disabled={toggle.isPending || !token}
            onPress={() => toggle.mutate(true)}
          />
        </>
      )}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: "QR code" }} />
      <Screen scroll bottomInset={spacing.xxl}>
        {projectQuery.error ? (
          <ErrorState
            message={
              projectQuery.error instanceof Error ? projectQuery.error.message : "Project not found"
            }
            onRetry={() => void projectQuery.refetch()}
          />
        ) : sideBySide ? (
          // On its side: the code on the left, what to do with it on the right.
          <View style={{ flexDirection: "row", gap: spacing.xl, alignItems: "flex-start" }}>
            <View style={{ flex: 1, alignItems: "center" }}>{qr}</View>
            <View style={{ flex: 1 }}>{controls}</View>
          </View>
        ) : (
          <View style={{ gap: spacing.lg }}>
            {qr}
            {controls}
          </View>
        )}
      </Screen>
    </>
  );
}
