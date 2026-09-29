import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Alert, Pressable, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkPortfolioSlug,
  uploadPortfolioLogo,
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
  firstUnansweredSection,
  GOOGLE_APPLY_FIELDS,
  needsGuidedSetup,
  reviewLinksToSave,
  sectionWithError,
  setupDismissedKey,
  SITE_PREVIEW_BLOCKS,
  SITE_SECTIONS,
  sitePreviewLine,
  skippedSections,
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
import type { PickedPhoto } from "@/api/portfolio-showcase";
import { useAuth } from "@/lib/auth";
import { radius, spacing, useLayout, useRightRail, useTheme } from "@/theme";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Check,
  Eye,
  ImageIcon,
  ImagePlus,
  Sparkles,
  X,
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
  StepProgress,
  Text,
  type LucideIcon,
} from "@/ui";
import { RichHtmlField } from "./RichHtmlField";
import { ShowcasePhotoPicker } from "./ShowcasePhotoPicker";
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
export function SiteEditor({
  site,
  onSaved,
  siteUrl = null,
  listedProjects = 0,
  onPublish,
  onGoToProjects,
}: {
  site: PortfolioSite;
  onSaved: () => void;
  /** The public address, for the live preview in the in-app browser. */
  siteUrl?: string | null;
  /** Projects published and listed on the site, for the Gallery block. */
  listedProjects?: number;
  onPublish?: (published: boolean) => Promise<void>;
  /** The Gallery block is filled from the Projects tab. */
  onGoToProjects?: () => void;
}) {
  const theme = useTheme();
  const rail = useRightRail();
  const { user } = useAuth();
  const original = useMemo(() => toSiteDraft(site), [site]);
  const [draft, setDraft] = useState<SiteDraft>(original);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [slugIssue, setSlugIssue] = useState<string | null>(null);
  const [open, setOpen] = useState<SiteSectionId | null>(null);
  const [heroPreview, setHeroPreview] = useState<string | null>(site.hero_image_url);
  const [heroPicking, setHeroPicking] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  /** Bumped when the draft is replaced from the server, so the About editor re-reads it. */
  const [seed, setSeed] = useState(0);
  /** The guided build's step, or null for the section list. Past the end is the finish screen. */
  const [guidedStep, setGuidedStep] = useState<number | null>(null);
  const split = useLayout().split();

  useEffect(() => {
    setDraft(original);
    setHeroPreview(site.hero_image_url);
    setSeed((n) => n + 1);
  }, [original, site.hero_image_url]);

  /*
   * The guided build opens by itself for a site missing any of its three
   * load-bearing answers, unless this person has already chosen the list, as
   * the web decides it. Resumes at the first unanswered section.
   */
  useEffect(() => {
    let cancelled = false;
    if (!needsGuidedSetup(original, site)) return;
    AsyncStorage.getItem(setupDismissedKey(site.id))
      .catch(() => null)
      .then((value) => {
        if (!cancelled && value !== "1") setGuidedStep(firstUnansweredSection(original, site));
      });
    return () => {
      cancelled = true;
    };
    // Judged once per portfolio, not on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

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

  const save = async ({ quiet = false }: { quiet?: boolean } = {}): Promise<boolean> => {
    const broken = sectionWithError(slugIssue ? { ...errors, slug: slugIssue } : errors);
    if (broken) {
      const label = SITE_SECTIONS.find((s) => s.id === broken)?.label ?? "the site";
      setMessage(`Fix the marked field in ${label} first.`);
      if (guidedStep !== null) setGuidedStep(SITE_SECTIONS.findIndex((s) => s.id === broken));
      else setOpen(broken);
      return false;
    }
    if (!dirty) return true;
    setSaving(true);
    setMessage(null);
    try {
      await updatePortfolio(patch);
      if (!quiet) setMessage("Site saved.");
      // Side by side the section stays on screen; a sheet closes.
      if (!split && !quiet) setOpen(null);
      onSaved();
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The site was not saved.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Leaves the guided build for the section list, and remembers the choice. */
  const exitGuided = async () => {
    if (dirty && !(await save({ quiet: true }))) return;
    setGuidedStep(null);
    await AsyncStorage.setItem(setupDismissedKey(site.id), "1").catch(() => undefined);
  };

  /** Continue: saves what changed, then moves. A failed save keeps you on the step. */
  const commitAnd = async (next: number) => {
    if (dirty && !(await save({ quiet: true }))) return;
    setMessage(null);
    setGuidedStep(next);
  };

  const pickLogo = async () => {
    if (!user?.id) return;
    const granted = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted.granted) {
      setMessage("Allow photo access to upload a logo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    setLogoBusy(true);
    setMessage(null);
    try {
      const url = await uploadPortfolioLogo(user.id, asset.uri, asset.width);
      set("logoUrl", url);
      setMessage("Logo uploaded. Save the site to put it live.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The logo was not uploaded.");
    } finally {
      setLogoBusy(false);
    }
  };

  const pickHero = (photos: PickedPhoto[]) => {
    setHeroPicking(false);
    const photo = photos[0];
    if (!photo) return;
    set("heroPhotoId", photo.id);
    setHeroPreview(photo.imageUrl);
  };

  /**
   * The live preview: the public site in the in-app browser, as a visitor
   * sees it. It shows what is saved, and only once the site is published, so
   * both are asked about first rather than opening a page that says neither.
   */
  const previewSite = async () => {
    if (!siteUrl) {
      setMessage("This build has no website address to open.");
      return;
    }
    const open = () => WebBrowser.openBrowserAsync(siteUrl);
    if (dirty && !(await save({ quiet: true }))) return;
    if (site.published) {
      await open();
      return;
    }
    Alert.alert(
      "Your site is not public yet",
      "The preview is your real site address, which shows your site once it is published.",
      [
        { text: "Cancel", style: "cancel" },
        ...(onPublish
          ? [
              {
                text: "Publish and open",
                onPress: async () => {
                  await onPublish(true);
                  await open();
                },
              },
            ]
          : []),
      ],
    );
  };

  const field = (
    key: Exclude<keyof SiteDraft, "showMap" | "showReviews" | "about" | "logoUrl" | "heroPhotoId">,
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
            <View style={{ gap: spacing.xs }}>
              <Text variant="bodyStrong">Logo</Text>
              <Text variant="caption" tone="muted">
                Sits in the site header and footer. Separate from your report logo.
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.secondary,
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {draft.logoUrl ? (
                    <Image
                      source={{ uri: draft.logoUrl }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="contain"
                      accessibilityLabel="Your site logo"
                    />
                  ) : (
                    <Icon icon={Building2} tone="muted" />
                  )}
                </View>
                <Button
                  label={draft.logoUrl ? "Replace logo" : "Upload logo"}
                  icon={ImagePlus}
                  size="sm"
                  variant="secondary"
                  loading={logoBusy}
                  disabled={logoBusy}
                  onPress={() => void pickLogo()}
                />
                {draft.logoUrl ? (
                  <IconButton
                    icon={Trash2}
                    tone="destructive"
                    accessibilityLabel="Remove the logo"
                    onPress={() =>
                      Alert.alert("Remove the logo?", "It comes off the site when you save.", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Remove", style: "destructive", onPress: () => set("logoUrl", "") },
                      ])
                    }
                  />
                ) : null}
              </View>
            </View>
            {field("accentColor", "Brand colour", {
              autoCapitalize: "none",
              placeholder: "#2563eb",
              hint: "Used for buttons, filters, map pins and the contact band.",
            })}
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
            <View style={{ gap: spacing.xs }}>
              <Text variant="bodyStrong">Hero photo</Text>
              <Text variant="caption" tone="muted">
                Your most impressive finished job, shot on site.
              </Text>
              {heroPreview && draft.heroPhotoId ? (
                <Image
                  source={{ uri: heroPreview }}
                  style={{ width: "100%", aspectRatio: 21 / 9, borderRadius: radius.md }}
                  contentFit="cover"
                  accessibilityLabel="Your hero photo"
                />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose a hero photo"
                  onPress={() => setHeroPicking(true)}
                  style={{
                    aspectRatio: 21 / 9,
                    borderRadius: radius.md,
                    backgroundColor: theme.colors.secondary,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing.xs,
                    padding: spacing.md,
                  }}
                >
                  <Icon icon={ImagePlus} tone="muted" />
                  <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
                    {draft.heroPhotoId
                      ? "Photo chosen. Save to see it here."
                      : "Tap to pick one. Without a hero, your newest project's cover is used."}
                  </Text>
                </Pressable>
              )}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                <Button
                  label={draft.heroPhotoId ? "Change photo" : "Choose photo"}
                  icon={ImagePlus}
                  size="sm"
                  variant="secondary"
                  onPress={() => setHeroPicking(true)}
                />
                {draft.heroPhotoId ? (
                  <Button
                    label="Use newest project"
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      set("heroPhotoId", "");
                      setHeroPreview(null);
                    }}
                  />
                ) : null}
              </View>
            </View>
            {field("heroHeadline", "Headline", {
              placeholder: "Roofing done right, the first time.",
              hint: "Big type over the photo. Your business or your promise, not one job's name.",
            })}
            {field("heroSubhead", "Sub-headline", {
              multiline: true,
              rows: 2,
              hint: "Optional. One line about the business, under the headline.",
            })}
            {/* Inside the section, so on a phone it opens over the section's sheet. */}
            <ShowcasePhotoPicker
              visible={heroPicking}
              title="Choose your hero photo"
              subtitle="The full-width shot at the top of your site. Pick your most impressive finished job."
              single
              confirmLabel="Use this photo"
              onClose={() => setHeroPicking(false)}
              onPick={pickHero}
            />
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
        return (
          <>
            <RichHtmlField
              label="About your business"
              hint="Crew, years, what you care about. Bold, lists and links are kept."
              html={draft.about}
              seed={seed}
              placeholder="We're a family-run crew..."
              onChange={(html) => set("about", html)}
            />
            {errors.about ? (
              <Text variant="caption" tone="destructive">
                {errors.about}
              </Text>
            ) : null}
          </>
        );
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

  /** The public site, block by block, as the web's Portfolio overview draws it. */
  const previewCard = (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">What visitors see</Text>
            <Text variant="caption" tone="muted">
              Your site, block by block. Tap one to change it.
            </Text>
          </View>
          <IconButton
            icon={Eye}
            accessibilityLabel="Preview the live site"
            disabled={saving}
            onPress={() => void previewSite()}
          />
        </View>
        <ListGroup>
          {SITE_PREVIEW_BLOCKS.map((block, i) => (
            <View key={block.id}>
              {i > 0 ? <RowDivider /> : null}
              <ListRow
                title={block.label}
                subtitle={sitePreviewLine(block.id, draft, site, listedProjects)}
                onPress={() => {
                  if (!block.section) {
                    onGoToProjects?.();
                    return;
                  }
                  setMessage(null);
                  if (guidedStep !== null) {
                    void commitAnd(SITE_SECTIONS.findIndex((x) => x.id === block.section));
                  } else {
                    setOpen(block.section);
                  }
                }}
              />
            </View>
          ))}
        </ListGroup>
      </View>
    </Card>
  );

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
          {needsGuidedSetup(draft, site) ? (
            <View
              style={{ flexDirection: "row", justifyContent: rail ? "flex-end" : "flex-start" }}
            >
              <Button
                label="Walk me through it"
                icon={Sparkles}
                size="sm"
                variant="secondary"
                onPress={() => {
                  setOpen(null);
                  setGuidedStep(firstUnansweredSection(draft, site));
                }}
              />
            </View>
          ) : null}
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

  if (guidedStep !== null) {
    const step = SITE_SECTIONS[guidedStep];
    const guided = (
      <Card>
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="overline" tone="muted">
                BUILD YOUR SITE
              </Text>
              <Text variant="title" accessibilityRole="header">
                {step ? `Step ${guidedStep + 1} of ${SITE_SECTIONS.length}` : "You're all set"}
              </Text>
              <Text variant="caption" tone="muted">
                {progress.done} of {progress.total} sections filled in. Everything saves as you go.
              </Text>
            </View>
            <IconButton
              icon={X}
              accessibilityLabel="Save and exit the guided setup"
              disabled={saving}
              onPress={() => void exitGuided()}
            />
          </View>
          <StepProgress
            steps={SITE_SECTIONS.map((x) => x.label)}
            currentIndex={Math.min(guidedStep, SITE_SECTIONS.length - 1)}
          />
          {message ? <Text variant="caption">{message}</Text> : null}
          {step ? (
            <>
              <View style={{ gap: 2 }}>
                <Text variant="heading">{step.question}</Text>
                <Text variant="caption" tone="muted">
                  {step.hint}
                </Text>
              </View>
              {fieldsFor(step.id)}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  justifyContent: "flex-end",
                }}
              >
                {guidedStep > 0 ? (
                  <IconButton
                    icon={ChevronLeft}
                    accessibilityLabel="Back a step"
                    disabled={saving}
                    onPress={() => void commitAnd(guidedStep - 1)}
                  />
                ) : null}
                <View style={{ flex: 1 }} />
                {step.optional && !siteSectionDone(step.id, draft, site) ? (
                  <Button
                    label="Skip for now"
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onPress={() => setGuidedStep(guidedStep + 1)}
                  />
                ) : null}
                <Button
                  label={guidedStep === SITE_SECTIONS.length - 1 ? "Finish" : "Continue"}
                  icon={guidedStep === SITE_SECTIONS.length - 1 ? Check : ChevronRight}
                  loading={saving}
                  disabled={saving}
                  onPress={() => void commitAnd(guidedStep + 1)}
                />
              </View>
            </>
          ) : (
            <>
              <Text variant="body">
                {site.published
                  ? "Your site is live. Anything you change from here saves to it."
                  : "Your site is ready to publish. Nobody can see it until you do."}
              </Text>
              {skippedSections(draft, site).length > 0 ? (
                <>
                  <Text variant="caption" tone="muted">
                    Skipped, not lost. Each one makes the site read better to a prospect.
                  </Text>
                  <ListGroup>
                    {skippedSections(draft, site).map((x, i) => (
                      <View key={x.id}>
                        {i > 0 ? <RowDivider /> : null}
                        <ListRow
                          icon={SECTION_ICONS[x.id]}
                          title={x.label}
                          subtitle={x.question}
                          onPress={() =>
                            setGuidedStep(SITE_SECTIONS.findIndex((y) => y.id === x.id))
                          }
                        />
                      </View>
                    ))}
                  </ListGroup>
                </>
              ) : null}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: spacing.sm,
                  justifyContent: rail ? "flex-end" : "flex-start",
                }}
              >
                <Button
                  label="Preview site"
                  icon={Eye}
                  size="sm"
                  variant="secondary"
                  onPress={() => void previewSite()}
                />
                {onGoToProjects ? (
                  <Button
                    label="Add projects"
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      void exitGuided();
                      onGoToProjects();
                    }}
                  />
                ) : null}
                {!site.published && onPublish ? (
                  <Button
                    label="Publish site"
                    icon={Check}
                    size="sm"
                    onPress={async () => {
                      await onPublish(true);
                      await exitGuided();
                    }}
                  />
                ) : (
                  <Button label="Done" icon={Check} size="sm" onPress={() => void exitGuided()} />
                )}
              </View>
            </>
          )}
        </View>
      </Card>
    );
    return split ? (
      <SplitPane list={previewCard} detail={guided} listWidth={320} />
    ) : (
      <View style={{ gap: spacing.md }}>
        {guided}
        {previewCard}
      </View>
    );
  }

  if (split) {
    return (
      <SplitPane
        list={
          <>
            {overview}
            {previewCard}
          </>
        }
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
      {previewCard}
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
