import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { router, Stack } from "expo-router";
import * as Location from "expo-location";
import { useQueryClient } from "@tanstack/react-query";
import { createProject, geocodeAddress } from "@/api/projects";
import { spacing, useTheme } from "@/theme";
import { LocateFixed, MapPin, TriangleAlert, User } from "@/ui/icons";
import {
  Button,
  Card,
  Field,
  Icon,
  SectionHeader,
  Text,
  type IconTone,
  type LucideIcon,
} from "@/ui";

/**
 * Start a job from the site.
 *
 * The screen asks the phone where it is the moment it opens, because the person
 * opening it is standing on the driveway of the answer. By the time the form has
 * rendered the four address fields are filled and the only thing left to type is
 * the customer's name, which is why that field is first and everything else is
 * under it.
 *
 * Nothing here is required. `newProjectName` gives an unnamed project a usable
 * name from whatever was filled in, so a crew that just needs somewhere to put
 * photos can create one and keep moving.
 *
 * The form used to build its inputs from a local `field()` helper, which is how
 * this screen ended up with a different input height and focus behaviour from
 * the login screen. It uses `Field` now, so there is one text input in the app
 * and it shows a focus ring, which on a phone is the only thing indicating
 * where the next keystroke will land once the keyboard covers half the screen.
 */

/** How the address on screen got there. Drives the one line under the card. */
type LocationPhase = "locating" | "found" | "pinned" | "denied" | "unavailable";

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
  const [phase, setPhase] = useState<LocationPhase>("locating");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pinToMyLocation = useCallback(async () => {
    setBusy("locating");
    setPhase("locating");
    setError(null);
    try {
      /*
       * On the automatic first run this is what raises the OS permission sheet,
       * which is the right moment for it: the user has just asked for a new
       * project at a site, so "allow location" is obviously about this job
       * rather than a prompt arriving out of nowhere on a settings screen.
       */
      const granted = await Location.requestForegroundPermissionsAsync();
      if (!granted.granted) {
        setPhase("denied");
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
      if (!place) {
        setPhase("pinned");
        return;
      }
      setStreet(
        (current) => current || [place.streetNumber, place.street].filter(Boolean).join(" "),
      );
      setCity((current) => current || place.city || place.subregion || "");
      setState((current) => current || place.region || "");
      setZip((current) => current || place.postalCode || "");
      setPhase("found");
    } catch (e) {
      setPhase("unavailable");
      setError(e instanceof Error ? e.message : "Could not read your location");
    } finally {
      setBusy(null);
    }
  }, []);

  // Runs on mount, before the user has touched anything. The address being
  // waiting for them is the entire point of the screen.
  useEffect(() => {
    void pinToMyLocation();
  }, [pinToMyLocation]);

  /**
   * What the project gets called when nobody names it.
   *
   * Customer plus street, because that is how a crew refers to a job out loud,
   * and because together they stay unique across a street of identical
   * addresses and a customer with four properties.
   */
  const suggestedName =
    clientName.trim() && street.trim()
      ? `${clientName.trim()} - ${street.trim()}`
      : clientName.trim() || street.trim();

  const addressLine =
    [street.trim(), city.trim(), [state.trim(), zip.trim()].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ") || null;

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
        name: name.trim() || suggestedName,
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

  const status: { tone: IconTone; icon: LucideIcon; title: string; detail?: string } = (() => {
    if (phase === "locating") {
      return {
        tone: "muted",
        icon: LocateFixed,
        title: "Finding the job site",
        detail: "Reading your phone's location",
      };
    }
    if (phase === "denied") {
      return {
        tone: "safety",
        icon: TriangleAlert,
        title: "Location is off for this app",
        detail: "Allow it in Settings, or type the address below.",
      };
    }
    if (phase === "unavailable") {
      return {
        tone: "safety",
        icon: TriangleAlert,
        title: "Your phone could not place you",
        detail: "Type the address below instead.",
      };
    }
    if (phase === "pinned" || !addressLine) {
      return {
        tone: "safety",
        icon: MapPin,
        title: "Pinned, but no address matched",
        detail: coords
          ? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
          : "Type the address below.",
      };
    }
    return {
      tone: "success",
      icon: MapPin,
      title: addressLine,
      detail: "Found from your phone. Worth a glance before you create the job.",
    };
  })();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <Stack.Screen options={{ title: "New project" }} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: spacing.xxxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/*
         * The site, found rather than typed, and first because it is already
         * done by the time the screen appears. The four inputs that produce it
         * sit below the customer's name now: they are the correction, not the
         * task.
         */}
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Icon icon={status.icon} size="md" tone={status.tone} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{status.title}</Text>
              {status.detail ? (
                <Text variant="caption" tone="muted">
                  {status.detail}
                </Text>
              ) : null}
            </View>
            <Button
              label={coords ? "Redo" : "Locate"}
              icon={coords ? undefined : LocateFixed}
              variant="ghost"
              size="sm"
              loading={busy === "locating"}
              disabled={Boolean(busy)}
              onPress={() => void pinToMyLocation()}
              accessibilityHint="Pins the project here and fills in the address"
            />
          </View>
        </Card>

        {/*
         * The one field this screen actually asks for. Everything above it was
         * filled in by the phone and everything below it is optional.
         */}
        <SectionHeader title="Who is this job for?" />
        <Field
          label="Customer"
          value={clientName}
          onChangeText={setClientName}
          autoCapitalize="words"
          autoComplete="name"
          icon={User}
          hint={
            suggestedName
              ? `This job will be called "${name.trim() || suggestedName}".`
              : "Names the project, and fills itself into every document for this job."
          }
        />

        <SectionHeader title="Address" />
        <Field
          label="Street"
          value={street}
          onChangeText={setStreet}
          autoCapitalize="words"
          autoComplete="street-address"
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

        <SectionHeader title="Optional" />
        <Field
          label="Project name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholder={suggestedName || "Named from the date if you leave this blank"}
        />

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
          /*
           * Only the save blocks this, not the locate. The locate now runs by
           * itself on mount, and gating Create on it meant the button was dead
           * for the first second or two of every visit - or indefinitely on a
           * phone that never gets a fix. Creating before the address lands is
           * allowed: `save` geocodes whatever was typed, and a project with no
           * pin is still a project.
           */
          disabled={busy === "creating"}
          onPress={() => void save()}
          style={{ marginTop: spacing.md }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
