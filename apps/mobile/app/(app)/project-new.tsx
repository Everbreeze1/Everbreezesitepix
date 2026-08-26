import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { router, Stack } from "expo-router";
import * as Location from "expo-location";
import { useQueryClient } from "@tanstack/react-query";
import { createProject, geocodeAddress } from "@/api/projects";
import { spacing, useTheme } from "@/theme";
import { LocateFixed, MapPin } from "@/ui/icons";
import { Button, Card, Field, Icon, SectionHeader, Text } from "@/ui";

/**
 * Start a job from the site.
 *
 * Everything except the address is optional, and even that is not required:
 * someone standing on a driveway with the crew waiting needs a project to
 * attach photos to, not a form. `newProjectName` gives an empty one a usable
 * name from whatever was filled in.
 *
 * The form used to build its inputs from a local `field()` helper, which is how
 * this screen ended up with a different input height and focus behaviour from
 * the login screen. It uses `Field` now, so there is one text input in the app
 * and it shows a focus ring, which on a phone is the only thing indicating
 * where the next keystroke will land once the keyboard covers half the screen.
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

  async function pinToMyLocation() {
    setBusy("locating");
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
    setBusy("creating");
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <Stack.Screen options={{ title: "New project" }} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
      >
        {/*
         * Location first, because it is the fastest path through this screen.
         * One tap pins the job and fills the four address fields below it, so
         * the crew types nothing at all in the common case.
         */}
        {coords ? (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Icon icon={MapPin} size="md" tone="success" />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Pinned to where you are</Text>
                <Text variant="caption" tone="muted">
                  {`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`}
                </Text>
              </View>
              <Button
                label="Redo"
                variant="ghost"
                size="sm"
                loading={busy === "locating"}
                onPress={() => void pinToMyLocation()}
              />
            </View>
          </Card>
        ) : (
          <Button
            label="Use my location"
            icon={LocateFixed}
            variant="outline"
            size="lg"
            fullWidth
            loading={busy === "locating"}
            disabled={Boolean(busy)}
            onPress={() => void pinToMyLocation()}
            accessibilityHint="Pins the project here and fills in the address"
          />
        )}

        <SectionHeader title="The job" />
        <Field label="Project name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Client" value={clientName} onChangeText={setClientName} autoCapitalize="words" />

        <SectionHeader title="Address" />
        <Field
          label="Street"
          value={street}
          onChangeText={setStreet}
          autoCapitalize="words"
          icon={MapPin}
        />
        <Field label="City" value={city} onChangeText={setCity} autoCapitalize="words" />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <Field
            label="State"
            value={state}
            onChangeText={setState}
            autoCapitalize="characters"
            style={{ flex: 1 }}
          />
          <Field
            label="Zip"
            value={zip}
            onChangeText={setZip}
            keyboardType="number-pad"
            style={{ flex: 1 }}
          />
        </View>

        {error ? (
          <Text variant="caption" tone="destructive">
            {error}
          </Text>
        ) : null}

        <Button
          label="Create project"
          size="lg"
          fullWidth
          loading={busy === "creating"}
          disabled={Boolean(busy)}
          onPress={() => void save()}
          style={{ marginTop: spacing.md }}
        />

        <Text variant="caption" tone="muted">
          Everything here is optional. An unnamed project is named from the address or the date.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
