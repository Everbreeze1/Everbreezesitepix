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
  sectionWithError,
  SITE_SECTIONS,
  siteDraftErrors,
  sitePatch,
  siteSectionDone,
  siteSectionProgress,
  siteSectionSummary,
  toSiteDraft,
  type GoogleApplyField,
  type PortfolioSite,
  type ReviewLink,
  type SiteDraft,
  type SiteSectionId,
} from "@/api/portfolio-view";
import { spacing, useLayout, useRightRail } from "@/theme";
import {
  Building2,
  ChevronRight,
  Check,
  ImageIcon,
  Link2,
  Mail,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Star,
  Tag,
  Trash2,
  UserRound,
} from "@/ui/icons";
import {
  Button,
  Card,
  Chip,
  Field,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  ProgressBar,
  RowDivider,
  SectionHeader,
  Sheet,
  SplitPane,
  Text,
  type LucideIcon,
} from "@/ui";
import { SwitchRow } from "./SwitchRow";

const SECTION_ICONS: Record<SiteSectionId, LucideIcon> = {
  business: Building2,
  services: Tag,
  cover: ImageIcon,
  areas: MapPin,
  about: UserRound,
  reviews: Star,
  contact: Mail,
  address: Link2,
};

/**
 * The Site tab, laid out as the web's site editor is.
 *
 * The web shows the site's eight sections (Business, What you do, Cover,
 * Where you work, About, Reviews, Contact, Web address) as a trail with a tick
 * on each one that is filled in, and puts one section on screen at a time.
 * The phone does the same: a short list of rows, each saying what is there
 * now, and a sheet holding just that section's few fields. The old version
 * stacked every field into one long form, which is what felt cumbersome.
 *
 * One draft covers every section and one Save sends only what changed
 * (`sitePatch`), so formatting made on the web survives a phone save.
 *
 * On a screen held on its side there is room for both at once, so the list
 * sits on the left and the chosen section's fields on the right, the way a
 * tablet's own Settings app works, instead of a sheet covering the list.
 */
export function SiteEditor({ site, onSaved }: { site: PortfolioSite; onSaved: () => void }) {
  const rail = useRightRail();
  const original = useMemo(() => toSiteDraft(site), [site]);
  const [draft, setDraft] = useState<SiteDraft>(original);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [slugIssue, setSlugIssue] = useState<string | null>(null);
  const [open, setOpen] = useState<SiteSectionId | null>(null);
  const split = useLayout().split();

  useEffect(() => setDraft(original), [original]);

  const set = <K extends keyof SiteDraft>(key: K, value: SiteDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const errors = siteDraftErrors(draft);
  const patch = sitePatch(original, draft);
  const dirty = Object.keys(patch).length > 0;
  const progress = siteSectionProgress(draft, site);

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
    const broken = sectionWithError(slugIssue ? { ...errors, slug: slugIssue } : errors);
    if (broken) {
      const label = SITE_SECTIONS.find((s) => s.id === broken)?.label ?? "the site";
      setMessage(`Fix the marked field in ${label} first.`);
      setOpen(broken);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await updatePortfolio(patch);
      setMessage("Site saved.");
      // Side by side the section stays on screen; a sheet closes.
      if (!split) setOpen(null);
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

  const fieldsFor = (id: SiteSectionId) => {
    switch (id) {
      case "business":
        return (
          <>
            {field("businessName", "Business name", { autoCapitalize: "words" })}
            {field("accentColor", "Brand colour", {
              autoCapitalize: "none",
              placeholder: "#2563eb",
              hint: "Used for buttons, filters, map pins and the contact band.",
            })}
            <Text variant="caption" tone="muted">
              The logo is uploaded on the website.
            </Text>
          </>
        );
      case "services":
        return field("services", "Your trades", {
          hint: "Separate with commas: Roofing, Gutters, Siding",
          multiline: true,
          rows: 3,
        });
      case "cover":
        return (
          <>
            {field("heroHeadline", "Headline", { placeholder: "Work you can point at." })}
            {field("heroSubhead", "Sub-headline", { multiline: true, rows: 2 })}
            <Text variant="caption" tone="muted">
              The cover photo is picked on the website.
            </Text>
          </>
        );
      case "areas":
        return (
          <>
            {field("serviceAreas", "Towns and cities", {
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
          </>
        );
      case "about":
        return field("about", "About your business", {
          multiline: true,
          rows: 6,
          hint: "Paragraphs are kept. Bold and links are edited on the web.",
        });
      case "reviews":
        return (
          <>
            <SwitchRow
              label="Show reviews on my site"
              hint="Your Google rating and review links."
              value={draft.showReviews}
              onChange={(next) => set("showReviews", next)}
            />
            <GoogleBusiness site={site} onChanged={onSaved} />
            <ReviewLinks />
          </>
        );
      case "contact":
        return (
          <>
            {field("phone", "Phone", { keyboardType: "phone-pad", autoComplete: "tel" })}
            {field("email", "Email", {
              keyboardType: "email-address",
              autoCapitalize: "none",
              autoComplete: "email",
            })}
            {field("address", "Address", {
              autoComplete: "street-address",
              hint: "Optional. Shown under the contact band.",
            })}
            {field("ctaLabel", "Button label", { placeholder: "Get a quote" })}
            {field("ctaUrl", "Button link", {
              autoCapitalize: "none",
              keyboardType: "url",
              placeholder: "https://",
            })}
            {field("websiteUrl", "Your main website", {
              autoCapitalize: "none",
              keyboardType: "url",
              placeholder: "https://",
            })}
          </>
        );
      case "address":
        return (
          <>
            {field("slug", "Site address", {
              autoCapitalize: "none",
              hint: "Changing it breaks every link already shared.",
            })}
            <SectionHeader title="Search engines" />
            {field("seoTitle", "Page title")}
            {field("seoDescription", "Description", { multiline: true, rows: 3 })}
          </>
        );
    }
  };

  // Side by side there is always a section showing: the first, until another is picked.
  const shown = open ?? (split ? (SITE_SECTIONS[0]?.id ?? null) : null);
  const index = shown ? SITE_SECTIONS.findIndex((s) => s.id === shown) : -1;
  const section = index >= 0 ? SITE_SECTIONS[index] : null;
  const next = index >= 0 ? SITE_SECTIONS[index + 1] : undefined;

  const saveButton = (
    <Button
      label="Save site"
      icon={Save}
      size="sm"
      loading={saving}
      disabled={saving || !dirty}
      onPress={() => void save()}
    />
  );

  const sectionFooter = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        justifyContent: rail ? "flex-end" : "space-between",
      }}
    >
      {next ? (
        <Button
          label={next.label}
          icon={ChevronRight}
          size="sm"
          variant="ghost"
          onPress={() => setOpen(next.id)}
        />
      ) : (
        <Text variant="caption" tone="muted">
          That is every section
        </Text>
      )}
      {saveButton}
    </View>
  );

  const sectionBody = section ? (
    <>
      <Text variant="caption" tone="muted">
        {section.hint}
      </Text>
      {message ? <Text variant="caption">{message}</Text> : null}
      {fieldsFor(section.id)}
    </>
  ) : null;

  const overview = (
    <>
      <Card>
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="bodyStrong">
                {progress.done} of {progress.total} sections filled in
              </Text>
              <Text variant="caption" tone={dirty ? "safety" : "muted"}>
                {dirty ? "Unsaved changes" : "All changes saved"}
              </Text>
            </View>
            {dirty ? saveButton : null}
          </View>
          <ProgressBar value={progress.done} total={progress.total} />
          {message ? <Text variant="caption">{message}</Text> : null}
        </View>
      </Card>

      <ListGroup>
        {SITE_SECTIONS.map((s, i) => {
          const done = siteSectionDone(s.id, draft, site);
          return (
            <View key={s.id}>
              {i > 0 ? <RowDivider /> : null}
              <ListRow
                icon={SECTION_ICONS[s.id]}
                iconTone={done ? "primary" : "muted"}
                title={s.label}
                subtitle={siteSectionSummary(s.id, draft, site)}
                right={
                  done && s.id !== "address" ? (
                    <Icon icon={Check} size="sm" tone="success" />
                  ) : s.optional && !done ? (
                    <Text variant="caption" tone="muted">
                      Optional
                    </Text>
                  ) : null
                }
                onPress={() => {
                  setMessage(null);
                  setOpen(s.id);
                }}
              />
            </View>
          );
        })}
      </ListGroup>
    </>
  );

  if (split) {
    return (
      <SplitPane
        list={overview}
        detail={
          section ? (
            <Card>
              <View style={{ gap: spacing.md }}>
                <View style={{ gap: 2 }}>
                  <Text variant="title" accessibilityRole="header">
                    {section.label}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {section.question}
                  </Text>
                </View>
                {sectionBody}
                {sectionFooter}
              </View>
            </Card>
          ) : null
        }
      />
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      {overview}
      <Sheet
        visible={section !== null}
        onClose={() => setOpen(null)}
        title={section?.label}
        subtitle={section?.question}
        footer={sectionFooter}
      >
        {sectionBody}
      </Sheet>
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
