import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Alert, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkPortfolioSlug,
  connectGoogleBusiness,
  disconnectGoogleBusiness,
  listReviewLinks,
  lookupGoogleBusiness,
  refreshGoogleBusiness,
  setReviewLinks,
  updatePortfolio,
  type GoogleBusinessProfile,
} from "@/api/portfolio";
import {
  defaultGoogleApply,
  GOOGLE_APPLY_FIELDS,
  reviewLinksToSave,
  siteDraftErrors,
  sitePatch,
  toSiteDraft,
  type GoogleApplyField,
  type PortfolioSite,
  type ReviewLink,
  type SiteDraft,
} from "@/api/portfolio-view";
import { spacing } from "@/theme";
import { Plus, RefreshCw, Save, Star, Trash2 } from "@/ui/icons";
import { Button, Card, Chip, Field, IconButton, SectionHeader, Text } from "@/ui";
import { SwitchRow } from "./SwitchRow";

/**
 * The Site tab: every section the web's site editor has, as one form.
 *
 * Business, what you do, where you work, about, reviews (Google Business and
 * other review links), contact and the button, the web address, search
 * engines, and the look. Saved with one button, and only what changed is sent
 * (`sitePatch`), so formatting made on the web survives a phone save.
 *
 * The logo upload and the cover photo picker stay on the web; they are named
 * at the foot of the form so nobody hunts for them.
 */
export function SiteEditor({ site, onSaved }: { site: PortfolioSite; onSaved: () => void }) {
  const original = useMemo(() => toSiteDraft(site), [site]);
  const [draft, setDraft] = useState<SiteDraft>(original);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [slugIssue, setSlugIssue] = useState<string | null>(null);

  useEffect(() => setDraft(original), [original]);

  const set = <K extends keyof SiteDraft>(key: K, value: SiteDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const errors = siteDraftErrors(draft);
  const patch = sitePatch(original, draft);
  const dirty = Object.keys(patch).length > 0;

  // Checked while typing, as the web does: moving the address breaks every
  // link already handed out, so "is it free" belongs before Save.
  useEffect(() => {
    const slug = draft.slug.trim().toLowerCase();
    if (slug === site.slug || errors.slug) {
      setSlugIssue(null);
      return;
    }
    const timer = setTimeout(() => {
      checkPortfolioSlug(slug)
        .then((result) => setSlugIssue(result.available ? null : (result.reason ?? "Taken.")))
        .catch(() => setSlugIssue(null));
    }, 450);
    return () => clearTimeout(timer);
  }, [draft.slug, site.slug, errors.slug]);

  const save = async () => {
    if (Object.keys(errors).length > 0 || slugIssue) {
      setMessage("Fix the fields marked below first.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await updatePortfolio(patch);
      setMessage("Site saved.");
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The site was not saved.");
    } finally {
      setSaving(false);
    }
  };

  const field = (
    key: Exclude<keyof SiteDraft, "showMap" | "showReviews">,
    label: string,
    extra: Partial<ComponentProps<typeof Field>> = {},
  ) => (
    <Field
      label={label}
      value={draft[key]}
      onChangeText={(next) => set(key, next)}
      error={key === "slug" ? (errors.slug ?? slugIssue ?? undefined) : errors[key]}
      {...extra}
    />
  );

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" tone={dirty ? "safety" : "muted"}>
            {dirty ? "Unsaved changes" : "All changes saved"}
          </Text>
          {message ? <Text variant="caption">{message}</Text> : null}
          <Button
            label="Save site"
            icon={Save}
            fullWidth
            loading={saving}
            disabled={saving || !dirty}
            onPress={() => void save()}
          />
        </View>
      </Card>

      <SectionHeader title="Business" />
      {field("businessName", "Business name", { autoCapitalize: "words" })}
      {field("heroHeadline", "Headline", { placeholder: "Work you can point at." })}
      {field("heroSubhead", "Intro line", { multiline: true, rows: 2 })}

      <SectionHeader title="What you do" />
      {field("services", "Services", {
        hint: "Separate with commas: Roofing, Gutters, Siding",
        multiline: true,
        rows: 2,
      })}

      <SectionHeader title="Where you work" />
      {field("serviceAreas", "Service areas", {
        hint: "Separate with commas: Leeds, York, Harrogate",
        multiline: true,
        rows: 2,
      })}
      <SwitchRow
        label="Show the project map"
        hint="Pins each published project on the site."
        value={draft.showMap}
        onChange={(next) => set("showMap", next)}
      />

      <SectionHeader title="About" />
      {field("about", "Who's behind the work", {
        multiline: true,
        rows: 6,
        hint: "Paragraphs are kept. Bold and links are edited on the web.",
      })}

      <SectionHeader title="Reviews" />
      <SwitchRow
        label="Show reviews"
        hint="Your Google rating and review links on the site."
        value={draft.showReviews}
        onChange={(next) => set("showReviews", next)}
      />
      <GoogleBusiness site={site} onChanged={onSaved} />
      <ReviewLinks />

      <SectionHeader title="Contact" />
      {field("phone", "Phone", { keyboardType: "phone-pad", autoComplete: "tel" })}
      {field("email", "Email", {
        keyboardType: "email-address",
        autoCapitalize: "none",
        autoComplete: "email",
      })}
      {field("address", "Address", { autoComplete: "street-address" })}
      {field("websiteUrl", "Your website", {
        autoCapitalize: "none",
        keyboardType: "url",
        placeholder: "https://",
      })}
      {field("ctaLabel", "Button label", { placeholder: "Get a quote" })}
      {field("ctaUrl", "Button link", {
        autoCapitalize: "none",
        keyboardType: "url",
        placeholder: "https://",
      })}

      <SectionHeader title="Web address" />
      {field("slug", "Address", {
        autoCapitalize: "none",
        hint: "Changing it breaks every link already shared.",
      })}

      <SectionHeader title="Search engines" />
      {field("seoTitle", "Page title")}
      {field("seoDescription", "Description", { multiline: true, rows: 3 })}

      <SectionHeader title="Look" />
      {field("accentColor", "Accent colour", {
        autoCapitalize: "none",
        placeholder: "#2563eb",
      })}

      <Text variant="caption" tone="muted">
        The logo upload and the cover photo are chosen on the website.
      </Text>

      <Button
        label="Save site"
        icon={Save}
        fullWidth
        loading={saving}
        disabled={saving || !dirty}
        onPress={() => void save()}
      />
    </View>
  );
}

/** Link, refresh or unlink the Google Business Profile, as the web's reviews step does. */
function GoogleBusiness({ site, onChanged }: { site: PortfolioSite; onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<GoogleBusinessProfile | null>(null);
  const [apply, setApply] = useState<GoogleApplyField[]>(() => defaultGoogleApply(site));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
      setNote(done);
      onChanged();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (site.google_place_id) {
    return (
      <Card>
        <View style={{ gap: spacing.sm }}>
          <Text variant="bodyStrong">{site.google_name ?? "Google Business Profile"}</Text>
          <Text variant="caption" tone="muted">
            {site.google_rating != null
              ? `${site.google_rating.toFixed(1)} stars from ${site.google_review_count ?? 0} reviews`
              : "Connected"}
          </Text>
          {note ? <Text variant="caption">{note}</Text> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button
              label="Refresh"
              icon={RefreshCw}
              size="sm"
              variant="secondary"
              disabled={busy}
              onPress={() => void run(refreshGoogleBusiness, "Refreshed from Google.")}
            />
            <Button
              label="Disconnect"
              size="sm"
              variant="ghost"
              disabled={busy}
              onPress={() =>
                Alert.alert("Disconnect Google?", "The rating comes off your site.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Disconnect",
                    style: "destructive",
                    onPress: () => void run(disconnectGoogleBusiness, "Disconnected."),
                  },
                ])
              }
            />
          </View>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <Text variant="bodyStrong">Connect Google Business Profile</Text>
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder="Paste your Google link, or name and town"
          autoCapitalize="none"
        />
        {found ? (
          <>
            <Text variant="body">{found.name}</Text>
            <Text variant="caption" tone="muted">
              {[
                found.address,
                found.rating != null ? `${found.rating} stars (${found.reviewCount ?? 0})` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <Text variant="caption" tone="muted">
              Copy onto the site:
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
              {GOOGLE_APPLY_FIELDS.map((f) => (
                <Chip
                  key={f.id}
                  label={f.label}
                  selected={apply.includes(f.id)}
                  onPress={() =>
                    setApply((prev) =>
                      prev.includes(f.id) ? prev.filter((x) => x !== f.id) : [...prev, f.id],
                    )
                  }
                />
              ))}
            </View>
            <Button
              label="Connect this listing"
              icon={Star}
              disabled={busy}
              onPress={() =>
                void run(() => connectGoogleBusiness(found.placeId, apply), "Connected.")
              }
            />
          </>
        ) : null}
        {note ? <Text variant="caption">{note}</Text> : null}
        {found ? null : (
          <Button
            label="Look it up"
            variant="secondary"
            disabled={busy || query.trim().length < 3}
            onPress={async () => {
              setBusy(true);
              setNote(null);
              try {
                const profile = await lookupGoogleBusiness(query.trim());
                setFound(profile);
                if (!profile) setNote("No listing found. Try the link from Google Maps.");
              } catch (e) {
                setNote(e instanceof Error ? e.message : "The lookup did not work.");
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </View>
    </Card>
  );
}

/** The other review links (Yelp, Houzz and so on) beside Google's. */
function ReviewLinks() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["review-links"], queryFn: listReviewLinks });
  const [rows, setRows] = useState<ReviewLink[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const all = query.data ?? [];
  const google = all.filter((link) => link.platform === "google");
  const others = rows ?? all.filter((link) => link.platform !== "google");

  const update = (index: number, patch: Partial<ReviewLink>) =>
    setRows(others.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await setReviewLinks([...google, ...reviewLinksToSave(others)]);
      setRows(null);
      setNote("Review links saved.");
      void queryClient.invalidateQueries({ queryKey: ["review-links"] });
    } catch (e) {
      setNote(e instanceof Error ? e.message : "The links were not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <Text variant="bodyStrong">Other review links</Text>
        {others.map((row, index) => (
          <View key={index} style={{ gap: spacing.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Field
                value={row.label ?? ""}
                onChangeText={(next) => update(index, { label: next })}
                placeholder="Yelp"
                style={{ flex: 1 }}
              />
              <IconButton
                icon={Trash2}
                accessibilityLabel="Remove this link"
                surface={false}
                onPress={() => setRows(others.filter((_, i) => i !== index))}
              />
            </View>
            <Field
              value={row.url}
              onChangeText={(next) => update(index, { url: next })}
              placeholder="https://"
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>
        ))}
        {note ? <Text variant="caption">{note}</Text> : null}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button
            label="Add a link"
            icon={Plus}
            size="sm"
            variant="secondary"
            onPress={() => setRows([...others, { platform: "custom", url: "", label: "" }])}
          />
          {rows ? (
            <Button label="Save links" size="sm" disabled={busy} onPress={() => void save()} />
          ) : null}
        </View>
      </View>
    </Card>
  );
}
