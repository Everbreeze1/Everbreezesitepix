import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/lib/auth";
import { uploadProjectPhoto } from "@/lib/photos";
import { colors } from "@/theme";

export default function CaptureScreen() {
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAsset(asset: ImagePicker.ImagePickerAsset) {
    if (!user || !projectId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await uploadProjectPhoto({
        userId: user.id,
        projectId,
        uri: asset.uri,
        mimeType: asset.mimeType,
      });
      setMessage("Photo saved to project");
      setTimeout(() => router.back(), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError("Camera permission is required");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      exif: true,
    });
    if (!result.canceled && result.assets[0]) await handleAsset(result.assets[0]);
  }

  async function pickLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Photo library permission is required");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsMultipleSelection: false,
    });
    if (!result.canceled && result.assets[0]) await handleAsset(result.assets[0]);
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Add a field photo</Text>
      <Text style={styles.sub}>
        Uploads to SitePix storage under this project (same path as web).
      </Text>

      {busy ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={colors.ink} size="large" />
      ) : (
        <View style={styles.actions}>
          <Pressable style={styles.button} onPress={() => void takePhoto()}>
            <Text style={styles.buttonText}>Take photo</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => void pickLibrary()}>
            <Text style={styles.secondaryText}>Choose from library</Text>
          </Pressable>
        </View>
      )}

      {message ? <Text style={styles.ok}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 24,
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.ink },
  sub: { marginTop: 8, fontSize: 14, color: colors.muted, lineHeight: 20 },
  actions: { marginTop: 32, gap: 12 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  secondary: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryText: { color: colors.ink, fontWeight: "600", fontSize: 16 },
  ok: { marginTop: 20, color: colors.ink, fontWeight: "500" },
  error: { marginTop: 20, color: colors.danger },
});
