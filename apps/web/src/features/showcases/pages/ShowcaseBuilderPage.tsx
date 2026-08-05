import { Link, useBlocker, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  ArrowLeft,
  Plus,
  X as XIcon,
  ArrowUp,
  ArrowDown,
  Eye,
  Pencil,
  Save,
  Share2,
  FolderPlus,
  Images,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useConfirm } from "@/hooks/use-confirm";
import { useProfile } from "@/hooks/use-profile";
import {
  getShowcase,
  updateShowcase,
  setShowcaseSections,
  type ShowcaseDetail,
} from "@/lib/showcases.functions";
import { getMyPortfolio, type MyPortfolio } from "@/lib/portfolio.functions";
import { ShowcaseShareDialog } from "@/features/showcases/components/ShowcaseShareDialog";
import { ShowcaseSiteCard } from "@/features/showcases/components/ShowcaseSiteCard";
import {
  ShowcasePhotoPickerDialog,
  type PickedPhoto,
} from "@/features/showcases/components/ShowcasePhotoPickerDialog";
import { ShowcaseView } from "@/components/ShowcaseView";

const DEFAULT_ACCENT = "#2563eb";

interface EditorItem {
  photo_id: string;
  caption: string;
  image_url: string;
}

interface EditorSection {
  /** Stable client-side key — server section ids are regenerated on every save. */
  key: string;
  project_id: string | null;
  project_name: string | null;
  title: string;
  body_html: string;
  items: EditorItem[];
}

let keySeq = 0;
const nextKey = () => `sec-${++keySeq}`;

/** Canonical serialization of everything that gets persisted — the dirty flag
 *  is a string comparison against the last-saved snapshot, so this must cover
 *  every editable field and nothing else (section keys are client-only). */
function makeSnapshot(v: {
  title: string;
  tagline: string;
  layout: string;
  accentColor: string;
  showContact: boolean;
  showReviews: boolean;
  introHtml: string;
  outroHtml: string;
  coverPhotoId: string | null;
  sections: EditorSection[];
}): string {
  return JSON.stringify({
    title: v.title,
    tagline: v.tagline,
    layout: v.layout,
    accentColor: v.accentColor,
    showContact: v.showContact,
    showReviews: v.showReviews,
    introHtml: v.introHtml,
    outroHtml: v.outroHtml,
    coverPhotoId: v.coverPhotoId,
    sections: v.sections.map((s) => ({
      p: s.project_id,
      t: s.title,
      b: s.body_html,
      i: s.items.map((it) => [it.photo_id, it.caption]),
    })),
  });
}

export function ShowcaseBuilderPage() {
  const { showcaseId } = useParams({ from: "/_app/showcases_/$showcaseId" });
  const { profile } = useProfile();
  const confirm = useConfirm();

  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [layout, setLayout] = useState<"grid" | "masonry" | "featured">("grid");
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [showContact, setShowContact] = useState(true);
  const [showReviews, setShowReviews] = useState(true);
  const [introHtml, setIntroHtml] = useState("");
  const [outroHtml, setOutroHtml] = useState("");
  const [sections, setSections] = useState<EditorSection[]>([]);
  /** Explicit masthead photo. Null falls back to the first photo in the body. */
  const [coverPhotoId, setCoverPhotoId] = useState<string | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);

  const [shareToken, setShareToken] = useState("");
  const [revokedAt, setRevokedAt] = useState<string | null>(null);

  /** Site-only metadata. Owned by <ShowcaseSiteCard>, which saves it itself —
   *  deliberately outside the document snapshot below. */
  const [detail, setDetail] = useState<ShowcaseDetail | null>(null);
  const [portfolio, setPortfolio] = useState<MyPortfolio | null>(null);

  /**
   * Picker target: a section key, "new" to build sections from projects, or
   * "cover" to choose the masthead photo. One dialog, three jobs — three
   * separate mounted dialogs would each load the same 300 photos.
   */
  const [pickerFor, setPickerFor] = useState<string | "new" | "cover" | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  /** Serialized last-saved state — the source of truth for the dirty flag. */
  const savedSnapshotRef = useRef<string>("");

  const snapshot = useMemo(
    () =>
      makeSnapshot({
        title,
        tagline,
        layout,
        accentColor,
        showContact,
        showReviews,
        introHtml,
        outroHtml,
        coverPhotoId,
        sections,
      }),
    [
      title,
      tagline,
      layout,
      accentColor,
      showContact,
      showReviews,
      introHtml,
      outroHtml,
      coverPhotoId,
      sections,
    ],
  );
  const dirty = !loading && snapshot !== savedSnapshotRef.current;

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const s = await getShowcase({ data: { id: showcaseId } });
      if (!s) {
        setLoadError("This showcase no longer exists.");
        return;
      }
      setTitle(s.title);
      setTagline(s.tagline ?? "");
      setLayout(s.layout as "grid" | "masonry" | "featured");
      setAccentColor(s.accent_color || DEFAULT_ACCENT);
      setShowContact(s.show_contact);
      setShowReviews(s.show_reviews);
      setIntroHtml(s.intro_html ?? "");
      setOutroHtml(s.outro_html ?? "");
      setShareToken(s.share_token);
      setRevokedAt(s.revoked_at);
      setDetail(s);
      setCoverPhotoId(s.cover_photo_id);
      setCoverImageUrl(s.cover_image_url);
      const loadedSections: EditorSection[] = s.sections.map((sec) => ({
        key: nextKey(),
        project_id: sec.project_id,
        project_name: sec.project_name,
        title: sec.title ?? "",
        body_html: sec.body_html ?? "",
        items: sec.items.map((it) => ({
          photo_id: it.photo_id,
          caption: it.caption ?? "",
          image_url: it.image_url,
        })),
      }));
      setSections(loadedSections);
      // Baseline is derived from the same values we just loaded rather than in
      // a follow-up effect — otherwise the first render after loading compares
      // against an empty ref and flashes "Unsaved changes".
      savedSnapshotRef.current = makeSnapshot({
        title: s.title,
        tagline: s.tagline ?? "",
        layout: s.layout,
        accentColor: s.accent_color || DEFAULT_ACCENT,
        showContact: s.show_contact,
        showReviews: s.show_reviews,
        introHtml: s.intro_html ?? "",
        outroHtml: s.outro_html ?? "",
        coverPhotoId: s.cover_photo_id,
        sections: loadedSections,
      });
    } catch (e: any) {
      setLoadError(e?.message ?? "Could not load showcase");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showcaseId]);

  // Fetched alongside, not inside, load(): the site card needs the portfolio's
  // slug and published state, but a portfolio that fails to load must not stop
  // the user editing the showcase itself.
  useEffect(() => {
    let cancelled = false;
    getMyPortfolio()
      .then((p) => {
        if (!cancelled) setPortfolio(p);
      })
      .catch(() => {
        if (!cancelled) setPortfolio(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await updateShowcase({
        data: {
          id: showcaseId,
          title: title.trim() || "Untitled showcase",
          tagline: tagline.trim() || null,
          layout,
          accentColor,
          showContact,
          showReviews,
          introHtml: introHtml || null,
          outroHtml: outroHtml || null,
          coverPhotoId,
        },
      });
      await setShowcaseSections({
        data: {
          showcaseId,
          sections: sections.map((s) => ({
            projectId: s.project_id,
            title: s.title.trim() || null,
            bodyHtml: s.body_html || null,
            items: s.items.map((it) => ({ photoId: it.photo_id, caption: it.caption || null })),
          })),
        },
      });
      savedSnapshotRef.current = snapshot;
      toast.success("Showcase saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save showcase");
    } finally {
      setSaving(false);
    }
  };

  // Nothing here autosaves, so leaving with unsaved edits would silently lose
  // them — confirm instead of discarding.
  useBlocker({
    shouldBlockFn: async () => {
      if (!dirty) return false;
      const leave = await confirm({
        title: "Leave without saving?",
        description: "This showcase has unsaved changes. If you leave now they won't be saved.",
        confirmText: "Leave",
        cancelText: "Stay",
        variant: "destructive",
      });
      return !leave;
    },
    enableBeforeUnload: () => dirty,
  });

  // ---- section editing ----
  const patchSection = (key: string, patch: Partial<EditorSection>) =>
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const addSection = () =>
    setSections((prev) => [
      ...prev,
      { key: nextKey(), project_id: null, project_name: null, title: "", body_html: "", items: [] },
    ]);

  const removeSection = (key: string) =>
    setSections((prev) => prev.filter((s) => s.key !== key));

  const moveSection = (key: string, dir: -1 | 1) =>
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });

  const moveItem = (sectionKey: string, index: number, dir: -1 | 1) =>
    setSections((prev) =>
      prev.map((s) => {
        if (s.key !== sectionKey) return s;
        const target = index + dir;
        if (target < 0 || target >= s.items.length) return s;
        const items = [...s.items];
        [items[index], items[target]] = [items[target], items[index]];
        return { ...s, items };
      }),
    );

  const removeItem = (sectionKey: string, photoId: string) =>
    setSections((prev) =>
      prev.map((s) =>
        s.key === sectionKey ? { ...s, items: s.items.filter((i) => i.photo_id !== photoId) } : s,
      ),
    );

  const setCaption = (sectionKey: string, photoId: string, caption: string) =>
    setSections((prev) =>
      prev.map((s) =>
        s.key === sectionKey
          ? {
              ...s,
              items: s.items.map((i) => (i.photo_id === photoId ? { ...i, caption } : i)),
            }
          : s,
      ),
    );

  const handlePicked = (picked: PickedPhoto[]) => {
    const target = pickerFor;
    setPickerFor(null);
    if (!picked.length || !target) return;

    if (target === "cover") {
      setCoverPhotoId(picked[0].id);
      setCoverImageUrl(picked[0].image_url);
      return;
    }

    if (target === "new") {
      // One section per project, titled with the project's name — this is the
      // "pick which project to show off" flow.
      const byProject = new Map<string, PickedPhoto[]>();
      for (const p of picked) {
        const list = byProject.get(p.project_id);
        if (list) list.push(p);
        else byProject.set(p.project_id, [p]);
      }
      const added: EditorSection[] = Array.from(byProject.entries()).map(([projectId, ps]) => ({
        key: nextKey(),
        project_id: projectId,
        project_name: ps[0].project_name,
        title: ps[0].project_name,
        body_html: "",
        items: ps.map((p) => ({ photo_id: p.id, caption: "", image_url: p.image_url })),
      }));
      setSections((prev) => [...prev, ...added]);
      toast.success(`Added ${added.length} section${added.length === 1 ? "" : "s"}`);
      return;
    }

    setSections((prev) =>
      prev.map((s) => {
        if (s.key !== target) return s;
        const existing = new Set(s.items.map((i) => i.photo_id));
        const fresh = picked.filter((p) => !existing.has(p.id));
        if (!fresh.length) {
          toast.info("Those photos are already in this section");
          return s;
        }
        return {
          ...s,
          items: [
            ...s.items,
            ...fresh.map((p) => ({ photo_id: p.id, caption: "", image_url: p.image_url })),
          ],
        };
      }),
    );
  };

  const photoCount = sections.reduce((n, s) => n + s.items.length, 0);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Fail loudly rather than rendering an empty editor the user could type into
  // and then lose — a failed load means Save would fail too.
  if (loadError) {
    return (
      <div className="p-6 sm:p-10">
        <Link
          to="/showcases"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Showcases
        </Link>
        <div className="mt-6 rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm font-bold text-foreground">Couldn't open this showcase</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">{loadError}</p>
          <Button className="mt-5" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const previewData = {
    title,
    tagline: tagline.trim() || null,
    layout,
    intro_html: introHtml || null,
    outro_html: outroHtml || null,
    accent_color: accentColor,
    show_contact: showContact,
    show_reviews: showReviews,
    // Explicit cover wins; otherwise the first photo in the body, which is what
    // the public page falls back to as well.
    cover_image_url:
      coverImageUrl ??
      sections.flatMap((s) => s.items).find((i) => i.image_url)?.image_url ??
      null,
    sections: sections.map((s) => ({
      id: s.key,
      project_name: s.project_name,
      title: s.title.trim() || null,
      body_html: s.body_html || null,
      items: s.items.map((i) => ({
        photo_id: i.photo_id,
        caption: i.caption || null,
        image_url: i.image_url,
      })),
    })),
  };
  const previewCompany = {
    name: profile?.company ?? null,
    logo_url: profile?.company_logo_url ?? null,
    phone: profile?.company_phone ?? null,
    address: profile?.company_address ?? null,
    email: profile?.email ?? null,
  };

  return (
    <div className="pb-16">
      {/* Sticky action bar — save state is always visible, so "did that save?"
          is never a question the user has to ask. */}
      <div className="sticky top-[82px] z-20 border-b border-border bg-background/95 px-6 py-3 backdrop-blur sm:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/showcases"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Showcases
          </Link>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "mr-1 inline-flex items-center gap-1.5 text-xs font-bold",
                dirty ? "text-amber-600" : "text-muted-foreground",
              )}
            >
              {dirty ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" /> All changes saved
                </>
              )}
            </span>

            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              <Button
                size="sm"
                variant={mode === "edit" ? "default" : "ghost"}
                className="h-8"
                onClick={() => setMode("edit")}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant={mode === "preview" ? "default" : "ghost"}
                className="h-8"
                onClick={() => setMode("preview")}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" /> Preview
              </Button>
            </div>

            <Button
              size="sm"
              variant={revokedAt ? "outline" : "secondary"}
              onClick={() => setShareOpen(true)}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              {revokedAt ? "Share" : "Shared"}
            </Button>

            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>

      {mode === "preview" ? (
        <div className="p-6 sm:p-10">
          <p className="mb-3 text-xs text-muted-foreground">
            Exactly what a prospect sees at your share link — no need to publish or open a new tab
            to check it.
          </p>
          <div className="overflow-hidden rounded-2xl border border-border">
            <ShowcaseView showcase={previewData} company={previewCompany} footer={false} />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 p-6 sm:p-10 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {/* Cover / headline */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="text-sm font-extrabold text-foreground">Cover</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The masthead of this project&rsquo;s page, and the thumbnail on your portfolio grid.
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <Label>Cover photo</Label>
                  <div className="overflow-hidden rounded-xl border border-border bg-muted">
                    {previewData.cover_image_url ? (
                      <img
                        src={previewData.cover_image_url}
                        alt=""
                        className="aspect-[16/9] w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[16/9] flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Images className="h-7 w-7 opacity-60" />
                        <p className="text-xs">Add photos below and one becomes the cover</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPickerFor("cover")}>
                      <Images className="mr-1.5 h-3.5 w-3.5" />
                      {coverPhotoId ? "Change cover" : "Choose cover"}
                    </Button>
                    {coverPhotoId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => {
                          setCoverPhotoId(null);
                          setCoverImageUrl(null);
                        }}
                      >
                        Use first photo
                      </Button>
                    )}
                    {!coverPhotoId && (
                      <span className="text-xs text-muted-foreground">
                        Using the first photo in this showcase.
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <Label>Title</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Kitchen & Bath Remodels"
                  />
                </div>
                <div>
                  <Label>Tagline (optional)</Label>
                  <Textarea
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    rows={2}
                    placeholder="One line about what makes this work stand out"
                  />
                </div>
              </div>
            </div>

            {/* Intro copy */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="text-sm font-extrabold text-foreground">Opening</p>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">
                Introduce the company — who you are, what you do, why prospects should call you.
              </p>
              <RichTextEditor
                value={introHtml}
                onChange={setIntroHtml}
                placeholder="We're a family-run remodeling crew serving…"
                minHeight={110}
              />
            </div>

            {/* Sections */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-extrabold text-foreground">Your work</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {sections.length} section{sections.length === 1 ? "" : "s"} · {photoCount} photo
                    {photoCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setPickerFor("new")}>
                    <FolderPlus className="mr-1.5 h-4 w-4" /> Add from projects
                  </Button>
                  <Button size="sm" variant="outline" onClick={addSection}>
                    <Plus className="mr-1.5 h-4 w-4" /> Blank section
                  </Button>
                </div>
              </div>

              {sections.length === 0 ? (
                <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center">
                  <Images className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-3 text-sm font-bold text-foreground">Nothing to show off yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                    “Add from projects” pulls in a job's photos and creates a section for it —
                    the fastest way to build this out.
                  </p>
                </div>
              ) : (
                <div className="mt-5 space-y-5">
                  {sections.map((section, idx) => (
                    <SectionEditor
                      key={section.key}
                      section={section}
                      index={idx}
                      total={sections.length}
                      onPatch={(patch) => patchSection(section.key, patch)}
                      onRemove={() => removeSection(section.key)}
                      onMove={(dir) => moveSection(section.key, dir)}
                      onAddPhotos={() => setPickerFor(section.key)}
                      onMoveItem={(i, dir) => moveItem(section.key, i, dir)}
                      onRemoveItem={(photoId) => removeItem(section.key, photoId)}
                      onCaption={(photoId, caption) => setCaption(section.key, photoId, caption)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Closing copy */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="text-sm font-extrabold text-foreground">Closing</p>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">
                A call to action — free estimates, service area, what to do next.
              </p>
              <RichTextEditor
                value={outroHtml}
                onChange={setOutroHtml}
                placeholder="Booking now for spring. Call for a free estimate…"
                minHeight={90}
              />
            </div>
          </div>

          {/* Right rail: site listing + design + share */}
          <div className="space-y-6">
            {/* Highest in the rail because it answers "will anyone see this?",
                which outranks every styling choice underneath it. */}
            {detail && (
              <ShowcaseSiteCard
                showcase={detail}
                portfolioSlug={portfolio?.portfolio?.slug ?? null}
                portfolioPublished={!!portfolio?.portfolio?.published}
                serviceTypeSuggestions={portfolio?.serviceTypes ?? []}
                onSaved={(patch) => setDetail((d) => (d ? { ...d, ...patch } : d))}
              />
            )}

            <div className="h-fit rounded-2xl border border-border bg-card p-6">
              <p className="text-sm font-extrabold text-foreground">Design</p>
              <div className="mt-4 space-y-4">
                <div>
                  <Label>Photo layout</Label>
                  <Select value={layout} onValueChange={(v) => setLayout(v as typeof layout)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="grid">Grid</SelectItem>
                      <SelectItem value="masonry">Masonry</SelectItem>
                      <SelectItem value="featured">Featured + grid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Brand colour</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded border border-input bg-background p-1"
                      aria-label="Brand colour"
                    />
                    <Input
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-9 font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">Contact block</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Shows your company phone, email and address at the bottom.
                    </p>
                  </div>
                  <Switch checked={showContact} onCheckedChange={setShowContact} />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">Ask for a review</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Adds your review links after the work. Turn off for a portfolio you send to
                      prospects.
                    </p>
                  </div>
                  <Switch checked={showReviews} onCheckedChange={setShowReviews} />
                </div>
                {showReviews && (
                  <p className="text-xs text-muted-foreground">
                    Review links come from{" "}
                    <Link to="/settings" className="underline">
                      Settings
                    </Link>
                    . Nothing shows here if you haven&rsquo;t added any.
                  </p>
                )}
                {showContact && !profile?.company_phone && !profile?.company_address && (
                  <p className="text-xs text-amber-600">
                    Your company phone and address are empty — add them in{" "}
                    <Link to="/settings" className="underline">
                      Settings
                    </Link>{" "}
                    so the contact block isn't blank.
                  </p>
                )}
              </div>
            </div>

            {/* Publishing lives in the Share dialog off the top bar — the same
                one the Showcases list uses — so there is a single place in the
                product that answers "how do I send this to someone?". */}
            <div className="h-fit rounded-2xl border border-border bg-card p-6">
              <p className="text-sm font-extrabold text-foreground">Status</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {revokedAt
                  ? "This showcase is a draft — only your team can see it."
                  : "Live. Anyone with the link can view it."}
              </p>
              <Button
                variant="outline"
                className="mt-4 w-full"
                onClick={() => setShareOpen(true)}
              >
                <Share2 className="mr-1.5 h-4 w-4" />
                {revokedAt ? "Publish & get link" : "Share link"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ShowcaseShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        showcaseId={showcaseId}
        title={title || "Untitled showcase"}
        shareToken={shareToken}
        revokedAt={revokedAt}
        onChanged={setRevokedAt}
        hasUnsavedChanges={dirty}
      />

      <ShowcasePhotoPickerDialog
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onPick={handlePicked}
        singleSelect={pickerFor === "cover"}
        title={
          pickerFor === "cover"
            ? "Choose the cover photo"
            : pickerFor === "new"
              ? "Add work from your projects"
              : "Add photos to this section"
        }
        description={
          pickerFor === "cover"
            ? "The full-width shot at the top of this project's page. The finished result usually sells it best."
            : pickerFor === "new"
              ? "Pick whole projects or individual photos — each project becomes its own section."
              : "Photos are grouped by project. Use “Select all” to pull in a whole job at once."
        }
        confirmLabel={pickerFor === "cover" ? "Use this photo" : "Add"}
      />
    </div>
  );
}

function SectionEditor({
  section,
  index,
  total,
  onPatch,
  onRemove,
  onMove,
  onAddPhotos,
  onMoveItem,
  onRemoveItem,
  onCaption,
}: {
  section: EditorSection;
  index: number;
  total: number;
  onPatch: (patch: Partial<EditorSection>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddPhotos: () => void;
  onMoveItem: (index: number, dir: -1 | 1) => void;
  onRemoveItem: (photoId: string) => void;
  onCaption: (photoId: string, caption: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {section.project_name && (
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
              {section.project_name}
            </p>
          )}
          <Input
            value={section.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            placeholder="Section heading (e.g. Full kitchen gut & rebuild)"
            className="font-bold"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move section up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Move section down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive"
            onClick={onRemove}
            aria-label="Remove section"
          >
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <RichTextEditor
          value={section.body_html}
          onChange={(html) => onPatch({ body_html: html })}
          placeholder="Describe the job — the problem, what your crew did, the result…"
          minHeight={80}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-muted-foreground">
          {section.items.length} photo{section.items.length === 1 ? "" : "s"}
        </p>
        <Button size="sm" variant="outline" onClick={onAddPhotos}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add photos
        </Button>
      </div>

      {section.items.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {section.items.map((item, i) => (
            <div key={item.photo_id} className="overflow-hidden rounded-lg border border-border">
              <div className="group relative aspect-[4/3] bg-muted">
                {item.image_url ? (
                  <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    Photo unavailable
                  </div>
                )}
                <div className="absolute inset-x-1 top-1 flex justify-between opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="flex gap-1">
                    <IconChip onClick={() => onMoveItem(i, -1)} disabled={i === 0} label="Move left">
                      <ArrowUp className="h-3 w-3 -rotate-90" />
                    </IconChip>
                    <IconChip
                      onClick={() => onMoveItem(i, 1)}
                      disabled={i === section.items.length - 1}
                      label="Move right"
                    >
                      <ArrowDown className="h-3 w-3 -rotate-90" />
                    </IconChip>
                  </div>
                  <IconChip onClick={() => onRemoveItem(item.photo_id)} label="Remove photo" destructive>
                    <XIcon className="h-3 w-3" />
                  </IconChip>
                </div>
              </div>
              <Textarea
                value={item.caption}
                onChange={(e) => onCaption(item.photo_id, e.target.value)}
                rows={2}
                placeholder="Caption (optional)"
                className="rounded-none border-0 border-t text-xs focus-visible:ring-0"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IconChip({
  children,
  onClick,
  disabled,
  label,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "grid h-6 w-6 place-items-center rounded-md bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80 disabled:opacity-30",
        destructive && "hover:bg-destructive",
      )}
    >
      {children}
    </button>
  );
}
