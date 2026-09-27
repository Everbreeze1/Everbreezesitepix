import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import * as Location from "expo-location";
import { useQueryClient } from "@tanstack/react-query";
import { createProject, geocodeAddress } from "@/api/projects";
import type { Coord } from "@/api/map-view";
import { SiteLocationMap } from "@/components/SiteLocationMap";
import { spacing, useTheme } from "@/theme";
import { LocateFixed, MapPin, Search, TriangleAlert, User } from "@/ui/icons";
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
 *
 * The site card carries a map, as the web form does. It is drawn straight away
 * in a "Locating" state, flies to the phone's fix when it lands, and the pin on
 * it is draggable: the fix is often a house out, and dragging is how the crew
 * says which one. A dragged pin reverse geocodes again and refills whichever
 * address fields the crew has not typed into themselves. Typing an address and
 * searching moves the pin the other way. Whatever the pin says is what is
 * saved.
 */

/** Wide enough to put the map beside the form rather than above it. */
const SIDE_BY_SIDE = 768;

type AddressField = "street" | "city" | "state" | "zip";

/** How the address on screen got there. Drives the one line under the card. */
type LocationPhase =
  | "locating"
  | "found"
  | "pinned"
  | "moved"
  | "searching"
  | "denied"
  | "unavailable";

export default function NewProjectScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const sideBySide = width >= SIDE_BY_SIDE;

  const [name, setName] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [clientName, setClientName] = useState("");
  const [coords, setCoords] = useState<Coord | null>(null);
  const [phase, setPhase] = useState<LocationPhase>("locating");
  const [permitted, setPermitted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * The address fields the crew has typed into. A moved pin refills every other
   * one, because those came from the previous pin and are now wrong, but never
   * these: a person who wrote the unit number knows it better than the
   * geocoder does. Cleared when they ask for their location outright, since
   * their corrections were to an address they have just replaced.
   */
  const editedRef = useRef<Set<AddressField>>(new Set());
  /** Only the newest reverse geocode may write; drags resolve out of order. */
  const lookupRef = useRef(0);

  const typed = (field: AddressField, set: (next: string) => void) => (next: string) => {
    editedRef.current.add(field);
    set(next);
  };

  /**
   * Refill the address from a moved pin, leaving the fields the crew typed.
   * Returns false when the geocoder had nothing to say about the spot.
   */
  const refillFrom = useCallback(async (coord: Coord): Promise<boolean> => {
    const id = ++lookupRef.current;
    const [place] = await Location.reverseGeocodeAsync(coord).catch(() => []);
    if (id !== lookupRef.current) return true;
    if (!place) return false;
    const edited = editedRef.current;
    if (!edited.has("street")) {
      setStreet([place.streetNumber, place.street].filter(Boolean).join(" "));
    }
    if (!edited.has("city")) setCity(place.city || place.subregion || "");
    if (!edited.has("state")) setState(place.region || "");
    if (!edited.has("zip")) setZip(place.postalCode || "");
    return true;
  }, []);

  const pinToMyLocation = useCallback(
    async ({ replace = false }: { replace?: boolean } = {}) => {
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
        setPermitted(true);
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const here = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setCoords(here);

        /*
         * An explicit re-locate replaces the address wholesale, typed fields
         * included: the crew has just said "not that place, this one".
         */
        if (replace) {
          editedRef.current = new Set();
          setPhase((await refillFrom(here)) ? "found" : "pinned");
          return;
        }

        /*
         * Reverse geocoding runs on the device, so it costs nothing and needs no
         * key. It only fills blank fields: someone who has already typed the
         * address knows it better than the geocoder does.
         */
        const id = ++lookupRef.current;
        const [place] = await Location.reverseGeocodeAsync(position.coords).catch(() => []);
        if (id !== lookupRef.current) return;
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
    },
    [refillFrom],
  );

  /** The crew dragged the pin, or long-pressed the map to drop it. */
  const movePin = useCallback(
    (coord: Coord) => {
      setCoords(coord);
      setPhase("moved");
      setError(null);
      void refillFrom(coord);
    },
    [refillFrom],
  );

  const addressQuery = [street, city, state, zip].filter((part) => part.trim()).join(", ");

  /** Typed address to pin, through the same geocoder the save falls back on. */
  async function findAddress() {
    if (!addressQuery) return;
    setBusy("searching");
    setPhase("searching");
    setError(null);
    // A search result must not be overwritten by a reverse geocode still in
    // flight from an earlier drag.
    lookupRef.current++;
    try {
      const found = await geocodeAddress(addressQuery);
      if (!found) {
        setPhase(coords ? "moved" : "pinned");
        setError("No match for that address. Drag the pin onto the site instead.");
        return;
      }
      setCoords(found);
      setPhase("moved");
    } finally {
      setBusy(null);
    }
  }

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
      // The pin, wherever it was dragged to, is the answer when there is one.
      if (!pin && addressQuery) pin = await geocodeAddress(addressQuery);

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
    if (phase === "searching") {
      return {
        tone: "muted",
        icon: Search,
        title: "Finding that address",
        detail: addressQuery,
      };
    }
    if (phase === "denied") {
      return {
        tone: "safety",
        icon: TriangleAlert,
        title: "Location is off for this app",
        detail: "Allow it in Settings, or type the address and search.",
      };
    }
    if (phase === "unavailable") {
      return {
        tone: "safety",
        icon: TriangleAlert,
        title: "Your phone could not place you",
        detail: "Type the address and search instead.",
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
    if (phase === "moved") {
      return {
        tone: "success",
        icon: MapPin,
        title: addressLine,
        detail: "Pin placed by you. This spot is what gets saved.",
      };
    }
    return {
      tone: "success",
      icon: MapPin,
      title: addressLine,
      detail: "Found from your phone. Drag the pin if it is not quite on the site.",
    };
  })();

  /*
   * The site, found rather than typed, and first because it is already done by
   * the time the screen appears. The four inputs that produce it sit below the
   * customer's name: they are the correction, not the task.
   */
  const siteCard = (
    <Card style={sideBySide ? { flex: 1 } : undefined}>
      <View style={{ gap: spacing.md, flex: sideBySide ? 1 : undefined }}>
        <SiteLocationMap
          coords={coords}
          locating={phase === "locating"}
          showsUserLocation={permitted}
          onPinMoved={movePin}
          height={sideBySide ? undefined : 240}
          style={sideBySide ? { flex: 1, height: undefined, minHeight: 320 } : undefined}
        />
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
            label={coords ? "Re-locate" : "Use my location"}
            icon={LocateFixed}
            variant="ghost"
            size="sm"
            loading={busy === "locating"}
            disabled={Boolean(busy)}
            onPress={() => void pinToMyLocation({ replace: true })}
            accessibilityHint="Moves the pin to where you are and fills in the address"
          />
        </View>
      </View>
    </Card>
  );

  const form = (
    <>
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
        onChangeText={typed("street", setStreet)}
        autoCapitalize="words"
        autoComplete="street-address"
        icon={MapPin}
        returnKeyType="search"
        onSubmitEditing={() => void findAddress()}
      />
      <Field
        label="City"
        value={city}
        onChangeText={typed("city", setCity)}
        autoCapitalize="words"
        returnKeyType="search"
        onSubmitEditing={() => void findAddress()}
      />
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <Field
          label="State"
          value={state}
          onChangeText={typed("state", setState)}
          autoCapitalize="characters"
          style={{ flex: 1 }}
        />
        <Field
          label="Zip"
          value={zip}
          onChangeText={typed("zip", setZip)}
          keyboardType="number-pad"
          style={{ flex: 1 }}
        />
      </View>
      <Button
        label="Find on map"
        icon={Search}
        variant="outline"
        fullWidth
        loading={busy === "searching"}
        disabled={!addressQuery || Boolean(busy)}
        onPress={() => void findAddress()}
        accessibilityHint="Moves the pin to the address you typed"
      />

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
         * Only the save blocks this, not the locate. The locate runs by itself
         * on mount, and gating Create on it meant the button was dead for the
         * first second or two of every visit, or indefinitely on a phone that
         * never gets a fix. Creating before the address lands is allowed:
         * `save` geocodes whatever was typed, and a project with no pin is
         * still a project.
         */
        disabled={busy === "creating"}
        onPress={() => void save()}
        style={{ marginTop: spacing.md }}
      />
    </>
  );

  const scrollPadding = {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <Stack.Screen options={{ title: "New project" }} />
      {sideBySide ? (
        /*
         * On a tablet the map gets the left half at full height and the form
         * scrolls beside it, so the pin stays in view while the address that
         * describes it is being corrected.
         */
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ flex: 1, padding: spacing.lg, paddingRight: 0 }}>{siteCard}</View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={scrollPadding}
            keyboardShouldPersistTaps="handled"
          >
            {form}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={scrollPadding} keyboardShouldPersistTaps="handled">
          {siteCard}
          {form}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
