import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import * as Location from "expo-location";
import { useQueryClient } from "@tanstack/react-query";
import { createProject, geocodeAddress } from "@/api/projects";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

/**
 * Start a job from the site.
 *
 * Everything except the address is optional, and even that is not required:
 * someone standing on a driveway with the crew waiting needs a project to
 * attach photos to, not a form. `newProjectName` gives an empty one a usable
 * name from whatever was filled in.
 */
export default function NewProjectScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [clientName, setClientName] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function useMyLocation() {
    setBusy("Finding you");
    setError(null);
    try {
      const granted = await Location.requestForegroundPermissionsAsync();
      if (!granted.granted) {
        setError("Location permission is needed to pin the project here");
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      /*
       * Reverse geocoding runs on the device, so it costs nothing and needs no
       * key. It only fills blank fields: someone who has already typed the
       * address knows it better than the geocoder does.
       */
      const [place] = await Location.reverseGeocodeAsync(position.coords).catch(() => []);
      if (place) {
        setStreet(
          (current) => current || [place.streetNumber, place.street].filter(Boolean).join(" "),
        );
        setCity((current) => current || place.city || place.subregion || "");
        setState((current) => current || place.region || "");
        setZip((current) => current || place.postalCode || "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read your location");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("Creating");
    setError(null);
    try {
      let pin = coords;

      // Only geocode when the crew typed an address and did not use the phone's
      // own fix. A device position is more accurate than a matched street.
      if (!pin) {
        const line = [street, city, state, zip].filter((part) => part.trim()).join(", ");
        if (line) pin = await geocodeAddress(line);
      }

      const project = await createProject({
        name,
        street,
        city,
        state,
        zip,
        clientName,
        latitude: pin?.latitude ?? null,
        longitude: pin?.longitude ?? null,
      });

      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.replace(`/project/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the project");
    } finally {
      setBusy(null);
    }
  }

  const field = (
    label: string,
    value: string,
    onChange: (text: string) => void,
    extra?: { autoCapitalize?: "none" | "words"; keyboardType?: "default" | "number-pad" },
  ) => (
    <View style={{ gap: spacing.xs }}>
      <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        autoCapitalize={extra?.autoCapitalize ?? "words"}
        keyboardType={extra?.keyboardType ?? "default"}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
            color: theme.colors.foreground,
          },
        ]}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <Stack.Screen options={{ title: "New project" }} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => void useMyLocation()}
          disabled={Boolean(busy)}
          style={[
            styles.locationButton,
            {
              borderColor: coords ? theme.colors.primary : theme.colors.border,
              backgroundColor: coords ? theme.colors.accent : theme.colors.card,
            },
          ]}
        >
          <Text
            style={[
              typography.bodyStrong,
              { color: coords ? theme.colors.accentForeground : theme.colors.primary },
            ]}
          >
            {busy === "Finding you"
              ? "Finding you…"
              : coords
                ? "Pinned to where you are"
                : "Use my location"}
          </Text>
        </Pressable>

        {field("Project name", name, setName)}
        {field("Street", street, setStreet)}
        {field("City", city, setCity)}
        {field("State", state, setState)}
        {field("Zip", zip, setZip, { keyboardType: "number-pad" })}
        {field("Client", clientName, setClientName)}

        {error ? (
          <Text style={[typography.caption, { color: theme.colors.destructive }]}>{error}</Text>
        ) : null}

        <Pressable
          onPress={() => void save()}
          disabled={Boolean(busy)}
          style={[
            styles.primary,
            { backgroundColor: theme.colors.primary, opacity: busy ? 0.6 : 1 },
          ]}
        >
          {busy === "Creating" ? (
            <ActivityIndicator color={theme.colors.primaryForeground} />
          ) : (
            <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
              Create project
            </Text>
          )}
        </Pressable>

        <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
          Everything here is optional. An unnamed project is named from the address or the date.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    minHeight: HIT_TARGET,
  },
  locationButton: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HIT_TARGET,
  },
  primary: {
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HIT_TARGET,
  },
});
