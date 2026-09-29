import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import * as Location from "expo-location";
import { router, Stack, useNavigation } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCompanyProfile } from "@/api/company";
import {
  getMyPortfolio,
  getShowcase,
  saveShowcase,
  saveShowcaseListing,
  setPortfolioShare,
} from "@/api/portfolio";
import {
  ACCENT_SWATCHES,
  addPhotosToSection,
  BUILDER_LAYOUTS,
  BUILDER_PARTS,
  builderErrors,
  builderPartSummary,
  builderSnapshot,
  coverPreview,
  defaultPickerProject,
  htmlSummary,
  isHexColour,
  listingErrors,
  listingSnapshot,
  moved,
  pagePath,
  parseProducts,
  photoCount,
  pinLabel,
  sectionKey,
  sectionsFromPicked,
  serviceTypeOptions,
  toBuilderDraft,
  toListingDraft,
  type BuilderDraft,
  type BuilderPartId,
  type BuilderSection,
  type ListingDraft,
  type PickedPhoto,
  type ShowcaseDetail,
} from "@/api/portfolio-showcase";
import { portfolioPageUrl } from "@/api/portfolio-view";
import { openShareSheet, publicUrl } from "@/api/sharing";
import { HeaderBackButton } from "@/components/HeaderBack";
import { webAppLink } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { radius, spacing, useLayout, useRightRail, useTheme } from "@/theme";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Eye,
  FolderPlus,
  ImageIcon,
  ImagePlus,
  Images,
  LayoutTemplate,
  LocateFixed,
  Palette,
  Pencil,
  Plus,
  Quote,
  Save,
  Share2,
  Globe,
  Trash2,
  X,
} from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  PhotoThumb,
  RowDivider,
  Screen,
  Sheet,
  SkeletonList,
  SplitPane,
  Text,
  useCardPage,
  type LucideIcon,
} from "@/ui";
import { AddressNotice } from "./AddressNotice";
import { RichHtmlField } from "./RichHtmlField";
import { ShowcasePhotoPicker } from "./ShowcasePhotoPicker";
import { SwitchRow } from "./SwitchRow";

const PART_ICONS: Record<BuilderPartId, LucideIcon> = {
  cover: ImageIcon,
  opening: Quote,
  work: Images,
  closing: Quote,
  design: Palette,
  listing: Globe,
};

type PickerTarget = "cover" | "new" | { section: string };

/**
 * One portfolio page, built on a phone: the web's `ShowcaseBuilderPage`.
 *
 * The web lays the page out as one long form beside a rail. The phone lists
 * its six parts (Cover, Opening, Your work, Closing, Design, On your site),
 * each saying what is in it now, and opens one at a time in the page itself,
 * with a way back to the list and on to the next. On a tablet held on its side
 * the list and the open part sit side by side.
 *
 * Saving matches the web: nothing autosaves, one Save writes the copy, design,
 * cover and every section with its photos, and leaving with unsaved changes
 * asks first. The page's site listing is saved on its own, as the web's
 * "On your site" card is, so re-filing a project never publishes half-written
 * copy.
 */
export function ShowcaseBuilder({ id }: { id: string }) {
  const theme = useTheme();
  const rail = useRightRail();
  const layout = useLayout();
  const split = layout.split();
  const { inset } = useCardPage();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const detailQuery = useQuery({ queryKey: ["portfolio-page", id], queryFn: () => getShowcase(id) });
  const siteQuery = useQuery({ queryKey: ["my-portfolio"], queryFn: getMyPortfolio });
  const companyQuery = useQuery({
    queryKey: ["portfolio-company", user?.id],
    queryFn: () => getCompanyProfile(user!.id),
    enabled: Boolean(user?.id),
  });

  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [saved, setSaved] = useState("");
  const [listing, setListing] = useState<ListingDraft | null>(null);
  const [listingSaved, setListingSaved] = useState("");
  const [productsText, setProductsText] = useState("");
  /** Bumped whenever the draft is replaced from the server, so text editors re-read it. */
  const [seed, setSeed] = useState(0);
  const [part, setPart] = useState<BuilderPartId | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [openText, setOpenText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [listingSaving, setListingSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [listingMessage, setListingMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<{ token: string | null; revoked: string | null }>({
    token: null,
    revoked: null,
  });

  const detail = detailQuery.data ?? null;
  const loadedFor = useRef<ShowcaseDetail | null>(null);

  const dirty = draft !== null && builderSnapshot(draft) !== saved;
  const listingDirty = listing !== null && listingSnapshot(listing) !== listingSaved;
  const unsaved = dirty || listingDirty;

  // Loaded once per fetch, and never over edits that have not been saved.
  useEffect(() => {
    if (!detail || loadedFor.current === detail) return;
    if (loadedFor.current && unsaved) return;
    loadedFor.current = detail;
    const next = toBuilderDraft(detail);
    setDraft(next);
    setSaved(builderSnapshot(next));
    const nextListing = toListingDraft(detail);
    setListing(nextListing);
    setListingSaved(listingSnapshot(nextListing));
    setProductsText(nextListing.productsUsed.join(", "));
    setStatus({ token: detail.share_token, revoked: detail.revoked_at });
    setSeed((n) => n + 1);
  }, [detail, unsaved]);

  const site = siteQuery.data?.portfolio ?? null;
  const serviceTypes = siteQuery.data?.serviceTypes ?? [];
  const webBase = webAppLink("/")?.replace(/\/+$/, "") ?? null;
  const published = Boolean(status.token) && !status.revoked;
  const shareLink = published ? publicUrl("showcases", status.token) : null;
  const savedSlug = detail?.slug ?? null;
  const livePageUrl =
    site?.published && published && detail?.on_site && savedSlug
      ? portfolioPageUrl(webBase, site.slug, savedSlug)
      : null;

  const set = <K extends keyof BuilderDraft>(key: K, value: BuilderDraft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  const setSections = (update: (sections: BuilderSection[]) => BuilderSection[]) =>
    setDraft((d) => (d ? { ...d, sections: update(d.sections) } : d));
  const patchSection = (key: string, patch: Partial<BuilderSection>) =>
    setSections((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const setListingField = <K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) =>
    setListing((l) => (l ? { ...l, [key]: value } : l));

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    const problems = builderErrors(draft);
    if (problems.length) {
      setMessage(problems[0] ?? null);
      return false;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveShowcase(id, draft);
      setSaved(builderSnapshot(draft));
      setMessage("Project saved.");
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save this project.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, id, queryClient]);

  const saveListing = async () => {
    if (!listing) return;
    if (Object.keys(listingErrors(listing)).length) {
      setListingMessage("Fix the marked field first.");
      return;
    }
    setListingSaving(true);
    setListingMessage(null);
    try {
      const result = await saveShowcaseListing(id, listing);
      // The service slugifies, so show what it stored rather than what was typed.
      const next = { ...listing, slug: result.slug ?? "" };
      setListing(next);
      setListingSaved(listingSnapshot(next));
      setListingMessage("Site details saved.");
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["my-portfolio"] });
    } catch (e) {
      setListingMessage(e instanceof Error ? e.message : "Could not save the site details.");
    } finally {
      setListingSaving(false);
    }
  };

  /*
   * Leaving. Back from an open part goes to the list of parts first, as a
   * page within the page. Leaving the page with unsaved edits asks, because
   * nothing here autosaves: the web's "Leave without saving?".
   */
  const stateRef = useRef({ unsaved, part, split });
  stateRef.current = { unsaved, part, split };
  const leaving = useRef(false);
  useEffect(() => {
    return navigation.addListener("beforeRemove", (event) => {
      const current = stateRef.current;
      if (leaving.current) return;
      if (current.part && !current.split) {
        event.preventDefault();
        setPart(null);
        return;
      }
      if (!current.unsaved) return;
      event.preventDefault();
      Alert.alert(
        "Leave without saving?",
        "This project has unsaved changes. If you leave now they won't be saved.",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => {
              leaving.current = true;
              navigation.dispatch(event.data.action);
            },
          },
        ],
      );
    });
  }, [navigation]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/portfolio");
  };

  const publish = async (enable: boolean) => {
    try {
      await setPortfolioShare(id, enable);
      setStatus((s) => ({ ...s, revoked: enable ? null : new Date().toISOString() }));
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio-page", id] });
      setMessage(enable ? "Published. Anyone with the link can view it." : "Unpublished.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not change the publish state.");
    }
  };

  const confirmPublish = () => {
    if (!draft) return;
    if (published) {
      Alert.alert(
        "Unpublish this project?",
        "The link stops working for anyone you sent it to, and the page leaves your site.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Unpublish", style: "destructive", onPress: () => void publish(false) },
        ],
      );
      return;
    }
    const empty = photoCount(draft) === 0;
    Alert.alert(
      empty ? "This page has no photos" : "Publish this project?",
      [
        empty
          ? "Publishing it puts a title on an empty page under your company name."
          : "Anyone with the link can view it, and it can be listed on your site.",
        dirty ? "Your unsaved changes are saved first." : "",
      ]
        .filter(Boolean)
        .join(" "),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: empty ? "Publish anyway" : "Publish",
          onPress: async () => {
            if (dirty && !(await save())) return;
            await publish(true);
          },
        },
      ],
    );
  };

  const openLive = async (url: string | null) => {
    if (!url) return;
    if (dirty) {
      Alert.alert(
        "Save first?",
        "The live page shows the last saved version, not your unsaved changes.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open saved version", onPress: () => void WebBrowser.openBrowserAsync(url) },
          {
            text: "Save and open",
            onPress: async () => {
              if (await save()) await WebBrowser.openBrowserAsync(url);
            },
          },
        ],
      );
      return;
    }
    await WebBrowser.openBrowserAsync(url);
  };

  const handlePicked = (photos: PickedPhoto[]) => {
    const target = picker;
    setPicker(null);
    if (!target || photos.length === 0) return;
    if (target === "cover") {
      const photo = photos[0]!;
      setDraft((d) => (d ? { ...d, coverPhotoId: photo.id, coverImageUrl: photo.imageUrl } : d));
      return;
    }
    if (target === "new") {
      const added = sectionsFromPicked(photos);
      setSections((all) => [...all, ...added]);
      setMessage(`Added ${added.length} section${added.length === 1 ? "" : "s"}.`);
      return;
    }
    const section = draft?.sections.find((s) => s.key === target.section);
    if (!section) return;
    const result = addPhotosToSection(section, photos);
    patchSection(section.key, result.section);
    if (result.added === 0) setMessage("Those photos are already in this section.");
  };

  const removeSection = (section: BuilderSection) =>
    Alert.alert(
      "Remove this section?",
      section.items.length
        ? `Its ${section.items.length} photo${section.items.length === 1 ? "" : "s"} come off this page. The photos stay on the job. Nothing changes until you save.`
        : "Nothing changes until you save.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => setSections((all) => all.filter((s) => s.key !== section.key)),
        },
      ],
    );

  if (detailQuery.isLoading || (detail && !draft)) {
    return (
      <>
        <Stack.Screen options={{ title: "Portfolio page" }} />
        <SkeletonList rows={5} />
      </>
    );
  }
  if (detailQuery.error || !detail || !draft || !listing) {
    return (
      <>
        <Stack.Screen options={{ title: "Portfolio page" }} />
        <View style={{ padding: spacing.lg }}>
          <ErrorState
            title="Couldn't open this project"
            message={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "This project no longer exists."
            }
            onRetry={() => void detailQuery.refetch()}
          />
        </View>
      </>
    );
  }

  const shown: BuilderPartId | null = part ?? (split ? "cover" : null);
  const partIndex = shown ? BUILDER_PARTS.findIndex((p) => p.id === shown) : -1;
  const partInfo = partIndex >= 0 ? BUILDER_PARTS[partIndex] : null;
  const nextPart = partIndex >= 0 ? BUILDER_PARTS[partIndex + 1] : undefined;
  const cover = coverPreview(draft);
  const photoColumns = Math.max(
    2,
    Math.min(4, Math.floor((split ? layout.width * 0.55 : layout.width) / 180)),
  );
  const listingErrs = listingErrors(listing);
  const typeOptions = serviceTypeOptions(serviceTypes);
  const colourOk = isHexColour(draft.accentColor);

  /* ---------------------------------------------------------------- parts */

  const coverPart = (
    <>
      {cover ? (
        <PhotoThumb uri={cover} aspectRatio={16 / 9} rounded={radius.md} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose the cover photo"
          onPress={() => setPicker("cover")}
          style={{
            aspectRatio: 16 / 9,
            borderRadius: radius.md,
            backgroundColor: theme.colors.secondary,
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.xs,
            padding: spacing.lg,
          }}
        >
          <Icon icon={ImagePlus} tone="muted" />
          <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
            Add photos in Your work and the first becomes the cover, or tap to pick one.
          </Text>
        </Pressable>
      )}
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}
      >
        <Button
          label={draft.coverPhotoId ? "Change cover" : "Choose cover"}
          icon={Images}
          size="sm"
          variant="secondary"
          onPress={() => setPicker("cover")}
        />
        {draft.coverPhotoId ? (
          <Button
            label="Use first photo"
            size="sm"
            variant="ghost"
            onPress={() =>
              setDraft((d) => (d ? { ...d, coverPhotoId: null, coverImageUrl: null } : d))
            }
          />
        ) : (
          <Text variant="caption" tone="muted">
            Using the first photo in this project.
          </Text>
        )}
      </View>
      <Field
        label="Title"
        value={draft.title}
        onChangeText={(next) => set("title", next)}
        placeholder="Kitchen and bath remodels"
        error={draft.title.trim().length > 160 ? "Keep the title under 160 characters." : undefined}
      />
      <Field
        label="Tagline"
        hint="Optional. One line about what makes this work stand out."
        value={draft.tagline}
        onChangeText={(next) => set("tagline", next)}
        multiline
        rows={2}
        error={
          draft.tagline.trim().length > 300 ? "Keep the tagline under 300 characters." : undefined
        }
      />
      <AddressNotice
        value={draft.tagline}
        city={listing.city}
        state={listing.state}
        onUseTownOnly={(next) => set("tagline", next)}
      />
    </>
  );

  const sectionCard = (section: BuilderSection, index: number) => {
    const total = draft.sections.length;
    const textOpen = openText === section.key;
    return (
      <Card key={section.key}>
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              {section.projectName ? (
                <Text variant="overline" tone="primary" numberOfLines={1}>
                  {section.projectName.toUpperCase()}
                </Text>
              ) : (
                <Text variant="overline" tone="muted">
                  SECTION {index + 1}
                </Text>
              )}
            </View>
            <IconButton
              icon={ChevronUp}
              size="sm"
              accessibilityLabel="Move section up"
              disabled={index === 0}
              onPress={() => setSections((all) => moved(all, index, -1))}
            />
            <IconButton
              icon={ChevronDown}
              size="sm"
              accessibilityLabel="Move section down"
              disabled={index === total - 1}
              onPress={() => setSections((all) => moved(all, index, 1))}
            />
            <IconButton
              icon={Trash2}
              size="sm"
              tone="destructive"
              accessibilityLabel="Remove section"
              onPress={() => removeSection(section)}
            />
          </View>
          <Field
            label="Heading"
            value={section.title}
            onChangeText={(next) => patchSection(section.key, { title: next })}
            placeholder="Full kitchen gut and rebuild"
          />
          {textOpen ? (
            <RichHtmlField
              label="Text"
              html={section.bodyHtml}
              seed={`${seed}-${section.key}`}
              placeholder="Describe the job: the problem, what your crew did, the result."
              onChange={(html) => patchSection(section.key, { bodyHtml: html })}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit this section's text"
              onPress={() => setOpenText(section.key)}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
            >
              <Text variant="body" tone="muted" style={{ flex: 1 }} numberOfLines={2}>
                {htmlSummary(section.bodyHtml, "No text yet. Tap to describe the job.", 140)}
              </Text>
              <Icon icon={Pencil} size="sm" tone="primary" />
            </Pressable>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {section.items.length} photo{section.items.length === 1 ? "" : "s"}
            </Text>
            <Button
              label="Add photos"
              icon={ImagePlus}
              size="sm"
              variant="secondary"
              onPress={() => setPicker({ section: section.key })}
            />
          </View>
          {section.items.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {section.items.map((item, i) => (
                <View
                  key={item.photoId}
                  style={{
                    width: `${Math.floor(100 / photoColumns) - 2}%`,
                    gap: spacing.xs,
                  }}
                >
                  <View>
                    <PhotoThumb uri={item.imageUrl || undefined} aspectRatio={4 / 3} />
                    <View
                      style={{
                        position: "absolute",
                        top: 4,
                        left: 4,
                        right: 4,
                        flexDirection: "row",
                        justifyContent: "space-between",
                      }}
                    >
                      <View style={{ flexDirection: "row", gap: 4 }}>
                        <IconButton
                          icon={ChevronLeft}
                          size="sm"
                          accessibilityLabel="Move photo earlier"
                          disabled={i === 0}
                          onPress={() =>
                            patchSection(section.key, { items: moved(section.items, i, -1) })
                          }
                        />
                        <IconButton
                          icon={ChevronRight}
                          size="sm"
                          accessibilityLabel="Move photo later"
                          disabled={i === section.items.length - 1}
                          onPress={() =>
                            patchSection(section.key, { items: moved(section.items, i, 1) })
                          }
                        />
                      </View>
                      <IconButton
                        icon={X}
                        size="sm"
                        tone="destructive"
                        accessibilityLabel="Take this photo off the page"
                        onPress={() =>
                          patchSection(section.key, {
                            items: section.items.filter((it) => it.photoId !== item.photoId),
                          })
                        }
                      />
                    </View>
                  </View>
                  <Field
                    value={item.caption}
                    onChangeText={(next) =>
                      patchSection(section.key, {
                        items: section.items.map((it) =>
                          it.photoId === item.photoId ? { ...it, caption: next } : it,
                        ),
                      })
                    }
                    placeholder="Caption (optional)"
                  />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </Card>
    );
  };

  const workPart = (
    <>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.sm,
          justifyContent: rail ? "flex-end" : "flex-start",
        }}
      >
        <Button
          label="Blank section"
          icon={Plus}
          size="sm"
          variant="secondary"
          onPress={() =>
            setSections((all) => [
              ...all,
              {
                key: sectionKey(),
                projectId: null,
                projectName: null,
                title: "",
                bodyHtml: "",
                items: [],
              },
            ])
          }
        />
        <Button
          label="Add from a job"
          icon={FolderPlus}
          size="sm"
          onPress={() => setPicker("new")}
        />
      </View>
      {draft.sections.length === 0 ? (
        <EmptyState
          icon={Images}
          title="Nothing to show off yet"
          body="Add from a job pulls in a job's photos and makes a section from them, the fastest way to build this out."
        />
      ) : (
        draft.sections.map(sectionCard)
      )}
    </>
  );

  const company = companyQuery.data;
  const designPart = (
    <>
      <Text variant="bodyStrong">Photo layout</Text>
      <ListGroup>
        {BUILDER_LAYOUTS.map((option, index) => (
          <View key={option.id}>
            {index > 0 ? <RowDivider /> : null}
            <ListRow
              icon={LayoutTemplate}
              iconTone={draft.layout === option.id ? "primary" : "muted"}
              title={option.label}
              subtitle={option.hint}
              chevron={false}
              right={draft.layout === option.id ? <Icon icon={Check} tone="primary" /> : null}
              onPress={() => set("layout", option.id)}
            />
          </View>
        ))}
      </ListGroup>
      <Text variant="bodyStrong">Brand colour</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {ACCENT_SWATCHES.map((colour) => {
          const on = draft.accentColor.trim().toLowerCase() === colour;
          return (
            <Pressable
              key={colour}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Colour ${colour}`}
              onPress={() => set("accentColor", colour)}
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.pill,
                backgroundColor: colour,
                borderWidth: on ? 3 : 1,
                borderColor: on ? theme.colors.foreground : theme.colors.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {on ? <Icon icon={Check} size="sm" tone="inverse" /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View
          style={{
            width: 40,
            height: 40,
            marginTop: 2,
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: colourOk ? draft.accentColor.trim() : "transparent",
          }}
        />
        <Field
          value={draft.accentColor}
          onChangeText={(next) => set("accentColor", next)}
          autoCapitalize="none"
          placeholder="#2563eb"
          error={colourOk ? undefined : "Use a colour like #2563eb."}
          style={{ flex: 1 }}
        />
      </View>
      <SwitchRow
        label="Contact block"
        hint="Shows your company phone, email and address at the bottom."
        value={draft.showContact}
        onChange={(next) => set("showContact", next)}
      />
      {draft.showContact && company && !company.company_phone && !company.company_address ? (
        <Text variant="caption" tone="safety">
          Your company phone and address are empty. Add them in Account, Company so the contact
          block is not blank.
        </Text>
      ) : null}
      <SwitchRow
        label="Ask for a review"
        hint="Adds your review links after the work. Turn off for a page you send to prospects."
        value={draft.showReviews}
        onChange={(next) => set("showReviews", next)}
      />
      {draft.showReviews ? (
        <Text variant="caption" tone="muted">
          Review links come from the Reviews section of your site. Nothing shows here if you have
          not added any.
        </Text>
      ) : null}
    </>
  );

  const listingPart = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Badge
          label={!published ? "Draft" : listing.onSite ? "Listed" : "Hidden"}
          tone={published && listing.onSite ? "success" : "neutral"}
          variant="soft"
        />
        <Text variant="caption" tone={listingDirty ? "safety" : "muted"} style={{ flex: 1 }}>
          {listingDirty ? "Unsaved" : "Saved"}
        </Text>
      </View>
      <SwitchRow
        label="Show on my site"
        hint={
          published
            ? "Appears in the grid, the map and your website embeds."
            : "Publish this page before it can be listed."
        }
        value={listing.onSite}
        onChange={(next) => setListingField("onSite", next)}
      />
      <SwitchRow
        label="Feature this project"
        hint="Adds a Featured badge to its card. The order is set on the Projects tab."
        value={listing.featured}
        onChange={(next) => setListingField("featured", next)}
      />
      <Field
        label="Page address"
        value={listing.slug}
        onChangeText={(next) => setListingField("slug", next.toLowerCase())}
        autoCapitalize="none"
        placeholder="oak-street-reroof"
        hint={pagePath(site?.slug, listing.slug)}
        error={listingErrs.slug}
      />
      <Field
        label="Service type"
        value={listing.serviceType}
        onChangeText={(next) => setListingField("serviceType", next)}
        placeholder="Roof replacement"
        hint="Becomes a filter on your site. Tap one you already use so the filter row stays short."
        error={listingErrs.serviceType}
      />
      {typeOptions.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {typeOptions.map((type) => {
            const on = listing.serviceType.trim().toLowerCase() === type.toLowerCase();
            return (
              <Chip
                key={type}
                label={type}
                selected={on}
                onPress={() => setListingField("serviceType", on ? "" : type)}
              />
            );
          })}
        </View>
      ) : null}
      <Field
        label="Card summary"
        value={listing.summary}
        onChangeText={(next) => setListingField("summary", next)}
        multiline
        rows={2}
        placeholder="Full tear-off and re-roof on a 1960s ranch."
        hint="One line, shown under the title on the grid and in search results."
        error={listingErrs.summary}
      />
      <AddressNotice
        value={listing.summary}
        city={listing.city}
        state={listing.state}
        onUseTownOnly={(next) => setListingField("summary", next)}
      />
      <Field
        label="Products used"
        value={productsText}
        onChangeText={(next) => {
          setProductsText(next);
          setListingField("productsUsed", parseProducts(next));
        }}
        placeholder="GAF Timberline HDZ, Ice and water shield"
        hint="Separate with commas."
        error={listingErrs.productsUsed}
      />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Field
          label="City"
          value={listing.city}
          onChangeText={(next) => setListingField("city", next)}
          placeholder="Sacramento"
          error={listingErrs.city}
          style={{ flex: 2 }}
        />
        <Field
          label="State"
          value={listing.state}
          onChangeText={(next) => setListingField("state", next)}
          placeholder="CA"
          error={listingErrs.state}
          style={{ flex: 1 }}
        />
      </View>
      <Text variant="caption" tone="muted">
        Used for the map pin and the areas served list.
      </Text>
      <PinControl
        latitude={listing.latitude}
        longitude={listing.longitude}
        onChange={(latitude, longitude) =>
          setListing((l) => (l ? { ...l, latitude, longitude } : l))
        }
      />
      <Field
        label="Completed"
        value={listing.completedOn}
        onChangeText={(next) => setListingField("completedOn", next)}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        error={listingErrs.completedOn}
      />
      {listingMessage ? <Text variant="caption">{listingMessage}</Text> : null}
      <View
        style={{
          flexDirection: "row",
          gap: spacing.sm,
          justifyContent: rail ? "flex-end" : "space-between",
        }}
      >
        {livePageUrl ? (
          <Button
            label="View live page"
            icon={ExternalLink}
            size="sm"
            variant="secondary"
            onPress={() => void WebBrowser.openBrowserAsync(livePageUrl)}
          />
        ) : null}
        <Button
          label="Save site details"
          icon={Save}
          size="sm"
          loading={listingSaving}
          disabled={listingSaving || !listingDirty}
          onPress={() => void saveListing()}
        />
      </View>
    </>
  );

  const partBody = (id: BuilderPartId) => {
    switch (id) {
      case "cover":
        return coverPart;
      case "opening":
        return (
          <RichHtmlField
            html={draft.introHtml}
            seed={`${seed}-intro`}
            placeholder="We're a family-run remodeling crew serving..."
            onChange={(html) => set("introHtml", html)}
          />
        );
      case "work":
        return workPart;
      case "closing":
        return (
          <RichHtmlField
            html={draft.outroHtml}
            seed={`${seed}-outro`}
            placeholder="Booking now for spring. Call for a free estimate..."
            onChange={(html) => set("outroHtml", html)}
          />
        );
      case "design":
        return designPart;
      case "listing":
        return listingPart;
    }
  };

  /* ------------------------------------------------------------- chrome */

  const statusCard = (
    <Card>
      <View
        style={{
          flexDirection: layout.width >= 520 ? "row" : "column",
          alignItems: layout.width >= 520 ? "center" : "stretch",
          gap: spacing.sm,
        }}
      >
        <View
          style={{
            flex: layout.width >= 520 ? 1 : undefined,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <Badge
            label={published ? "Live" : "Draft"}
            tone={published ? "success" : "neutral"}
            variant={published ? "soft" : "outline"}
          />
          <Text variant="caption" tone={dirty ? "safety" : "muted"} style={{ flex: 1 }}>
            {dirty ? "Unsaved changes" : "All changes saved"}
          </Text>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            justifyContent: "flex-end",
          }}
        >
          <IconButton
            icon={Eye}
            accessibilityLabel="Preview this page"
            onPress={() => setPreviewOpen(true)}
          />
          {published ? (
            <IconButton
              icon={ExternalLink}
              accessibilityLabel="Open the live page"
              onPress={() => void openLive(shareLink)}
            />
          ) : null}
          {published ? (
            <IconButton
              icon={Share2}
              accessibilityLabel="Send the link"
              onPress={() => (shareLink ? void openShareSheet(shareLink, draft.title) : undefined)}
            />
          ) : null}
          <Button
            label={published ? "Unpublish" : "Publish"}
            size="sm"
            variant={published ? "ghost" : "secondary"}
            onPress={confirmPublish}
          />
          <Button
            label="Save"
            icon={Save}
            size="sm"
            loading={saving}
            disabled={saving || !dirty}
            onPress={() => void save()}
          />
        </View>
      </View>
      {message ? (
        <Text variant="caption" style={{ marginTop: spacing.sm }}>
          {message}
        </Text>
      ) : null}
    </Card>
  );

  const partsList = (
    <ListGroup>
      {BUILDER_PARTS.map((p, i) => (
        <View key={p.id}>
          {i > 0 ? <RowDivider /> : null}
          <ListRow
            icon={PART_ICONS[p.id]}
            iconTone={shown === p.id && split ? "primary" : "muted"}
            title={p.label}
            subtitle={builderPartSummary(p.id, draft, listing)}
            right={
              p.id === "listing" && listingDirty ? (
                <Badge label="Unsaved" tone="warning" variant="soft" />
              ) : undefined
            }
            onPress={() => setPart(p.id)}
          />
        </View>
      ))}
    </ListGroup>
  );

  const partView = partInfo ? (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {split ? null : (
            <IconButton
              icon={ChevronLeft}
              accessibilityLabel="All parts of this page"
              surface={false}
              onPress={() => setPart(null)}
            />
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" accessibilityRole="header">
              {partInfo.label}
            </Text>
            <Text variant="caption" tone="muted">
              {partInfo.hint}
            </Text>
          </View>
        </View>
        {partBody(partInfo.id)}
        <View style={{ flexDirection: "row", justifyContent: rail ? "flex-end" : "space-between" }}>
          {split ? null : (
            <Button
              label="All parts"
              icon={ChevronLeft}
              size="sm"
              variant="ghost"
              onPress={() => setPart(null)}
            />
          )}
          {nextPart ? (
            <Button
              label={nextPart.label}
              icon={ChevronRight}
              size="sm"
              variant="ghost"
              onPress={() => setPart(nextPart.id)}
            />
          ) : null}
        </View>
      </View>
    </Card>
  ) : null;

  const pickerTitle =
    picker === "cover"
      ? "Choose the cover photo"
      : picker === "new"
        ? "Add work from a job"
        : "Add photos to this section";
  const pickerSubtitle =
    picker === "cover"
      ? "The full-width shot at the top of this page. The finished result usually sells it best."
      : picker === "new"
        ? "Pick a job, then its photos. They become a section of their own."
        : "Pick a job, then the photos to add.";
  const pickerProject =
    picker && typeof picker === "object"
      ? (draft.sections.find((s) => s.key === picker.section)?.projectId ??
        defaultPickerProject(draft))
      : defaultPickerProject(draft);

  return (
    <>
      <Stack.Screen
        options={{
          title: draft.title.trim() || "Portfolio page",
          headerLeft: () => <HeaderBackButton onPress={goBack} />,
          headerRight: () => (
            <IconButton
              icon={Save}
              tone="primary"
              surface={false}
              accessibilityLabel="Save this project"
              disabled={saving || !dirty}
              onPress={() => void save()}
            />
          ),
        }}
      />
      <Screen scroll padded={false} bottomInset={spacing.xxl}>
        <View style={{ paddingHorizontal: inset, paddingTop: spacing.lg, gap: spacing.md }}>
          {statusCard}
          {split ? (
            <SplitPane list={partsList} detail={partView} />
          ) : part ? (
            partView
          ) : (
            <>
              <PhotoThumb uri={cover ?? undefined} aspectRatio={21 / 9} rounded={radius.md} />
              {partsList}
            </>
          )}
        </View>
      </Screen>

      <ShowcasePhotoPicker
        visible={picker !== null}
        title={pickerTitle}
        subtitle={pickerSubtitle}
        single={picker === "cover"}
        initialProjectId={pickerProject}
        confirmLabel={picker === "cover" ? "Use this photo" : "Add"}
        onClose={() => setPicker(null)}
        onPick={handlePicked}
      />

      <Sheet
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview"
        subtitle="What a prospect sees at your link, including unsaved changes."
        maxHeightRatio={0.92}
      >
        <ShowcasePreview draft={draft} columns={photoColumns} />
      </Sheet>
    </>
  );
}

/** Pin the project where the phone is standing, or clear the pin. */
function PinControl({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number | null, longitude: number | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const pinHere = async () => {
    setBusy(true);
    setNote(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setNote("Location is off for this app, so the pin cannot be placed here.");
        return;
      }
      const fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000)),
      ]);
      if (!fix) {
        setNote("No location fix yet. Try again outside or near a window.");
        return;
      }
      onChange(
        Math.round(fix.coords.latitude * 1e6) / 1e6,
        Math.round(fix.coords.longitude * 1e6) / 1e6,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not read the location.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="bodyStrong">Map pin</Text>
      <Text variant="caption" tone="muted">
        {pinLabel(latitude, longitude)}
      </Text>
      {note ? <Text variant="caption">{note}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        <Button
          label="Pin where I'm standing"
          icon={LocateFixed}
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={busy}
          onPress={() => void pinHere()}
        />
        {latitude != null ? (
          <Button
            label="Clear pin"
            size="sm"
            variant="ghost"
            onPress={() => onChange(null, null)}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The page as a prospect will see it, from the draft: the web's Preview mode.
 * A simplified drawing (no fonts or layout engine of the public site), so it
 * answers "is everything there, in the right order" without saving first.
 */
function ShowcasePreview({ draft, columns }: { draft: BuilderDraft; columns: number }) {
  const theme = useTheme();
  const cover = coverPreview(draft);
  const accent = isHexColour(draft.accentColor) ? draft.accentColor.trim() : theme.colors.primary;
  const lead = draft.layout === "featured";
  return (
    <View style={{ gap: spacing.md }}>
      {cover ? <PhotoThumb uri={cover} aspectRatio={16 / 9} rounded={radius.md} /> : null}
      <View style={{ gap: spacing.xs }}>
        <View style={{ height: 4, width: 48, borderRadius: 2, backgroundColor: accent }} />
        <Text variant="title">{draft.title.trim() || "Untitled project"}</Text>
        {draft.tagline.trim() ? (
          <Text variant="body" tone="muted">
            {draft.tagline.trim()}
          </Text>
        ) : null}
      </View>
      {htmlSummary(draft.introHtml, "", 100000) ? (
        <Text variant="body">{htmlSummary(draft.introHtml, "", 100000)}</Text>
      ) : null}
      {draft.sections.map((section) => (
        <View key={section.key} style={{ gap: spacing.sm }}>
          {section.title.trim() ? <Text variant="heading">{section.title.trim()}</Text> : null}
          {htmlSummary(section.bodyHtml, "", 100000) ? (
            <Text variant="body">{htmlSummary(section.bodyHtml, "", 100000)}</Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            {section.items.map((item, i) => (
              <View
                key={item.photoId}
                style={{
                  width: lead && i === 0 ? "100%" : `${Math.floor(100 / columns) - 2}%`,
                  gap: 2,
                }}
              >
                <PhotoThumb
                  uri={item.imageUrl || undefined}
                  aspectRatio={draft.layout === "masonry" ? (i % 3 === 1 ? 3 / 4 : 4 / 3) : 4 / 3}
                />
                {item.caption.trim() ? (
                  <Text variant="caption" tone="muted">
                    {item.caption.trim()}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ))}
      {htmlSummary(draft.outroHtml, "", 100000) ? (
        <Text variant="body">{htmlSummary(draft.outroHtml, "", 100000)}</Text>
      ) : null}
      {draft.showContact ? (
        <Text variant="caption" tone="muted">
          Your company phone, email and address show here.
        </Text>
      ) : null}
      {draft.showReviews ? (
        <Text variant="caption" tone="muted">
          Your review links show here.
        </Text>
      ) : null}
    </View>
  );
}
