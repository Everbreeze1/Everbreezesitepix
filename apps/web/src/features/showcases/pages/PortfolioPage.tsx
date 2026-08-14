import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, Code2, ExternalLink, Globe, Layers, Loader2, Copy, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { useSubscription } from "@/hooks/use-subscription";
import { cn } from "@/lib/utils";
import {
  getMyPortfolio,
  updatePortfolio,
  type MyPortfolio,
  type PortfolioDetail,
} from "@/lib/portfolio.functions";
import { PortfolioSitePanel } from "@/features/showcases/components/PortfolioSitePanel";
import { PortfolioSetupWizard } from "@/features/showcases/components/PortfolioSetupWizard";
import { PortfolioEmbedsPanel } from "@/features/showcases/components/PortfolioEmbedsPanel";
import { ShowcasesPanel } from "@/features/showcases/components/ShowcasesPanel";
import { needsGuidedSetup } from "@/features/showcases/components/PortfolioSiteSteps";
import { toDraft } from "@/features/showcases/site-draft";

/**
 * Portfolio - the home for everything that used to be "Showcases".
 *
 * The rename is the point, not decoration. The client's note was that a
 * showcase "looks like a very beautiful report… it's like a mini site that
 * should be created", and the reason it read that way is that a showcase *was*
 * the whole deliverable. Reframing it as one project inside a portfolio is what
 * makes the site, the grid and the embeds all obviously belong together.
 *
 * Three tabs, matching the three things a contractor can do with their work:
 *   Site      - the mini-site itself
 *   Projects  - the showcases that fill it
 *   Embeds    - putting it on the website they already have
 */
export function PortfolioPage() {
  const { isTeam, loading: subLoading } = useSubscription();
  const [data, setData] = useState<MyPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [tab, setTab] = useState("site");
  /** null until the loaded portfolio has been judged; then true = wizard open. */
  const [guided, setGuided] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getMyPortfolio());
    } catch (e: any) {
      setError(e?.message ?? "Could not load your portfolio");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isTeam) void load();
  }, [isTeam, load]);

  // Decide once per load whether this person is *building* a site or editing
  // one. A blank portfolio dropped straight into the section editor is the
  // overwhelm the wizard exists to remove, and a finished one interrupted by a
  // seven-step queue is worse. Dismissal is remembered so "I'd rather do this
  // my own way" survives a refresh.
  useEffect(() => {
    if (guided !== null || !data) return;
    const p = data.portfolio;
    if (!p || data.canEdit === false) {
      setGuided(false);
      return;
    }
    setGuided(!isSetupDismissed(p.id) && needsGuidedSetup(toDraft(p)));
  }, [data, guided]);

  // `portfolio` is null for a plain member of a team that has no portfolio yet
  // (create-on-read is an owner/admin privilege - see getMyPortfolioService),
  // so a patch has nothing to merge into and must be a no-op rather than
  // spreading null into a half-built object.
  const patchPortfolio = (patch: Partial<PortfolioDetail>) =>
    setData((d) => (d?.portfolio ? { ...d, portfolio: { ...d.portfolio, ...patch } } : d));

  const togglePublished = async (published: boolean) => {
    setPublishing(true);
    try {
      await updatePortfolio({ data: { published } });
      patchPortfolio({ published });
      toast.success(published ? "Your portfolio site is live" : "Portfolio unpublished");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change publish state");
    } finally {
      setPublishing(false);
    }
  };

  // `guided === null` means the effect above hasn't judged this portfolio yet.
  // Holding the spinner for that one frame avoids flashing the tabbed editor at
  // someone who is about to be shown the wizard instead.
  if (subLoading || (isTeam && loading) || (isTeam && data?.portfolio && guided === null)) {
    return (
      <div className="flex min-h-full items-center justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isTeam) {
    return (
      <div className="p-6 sm:p-10">
        <PageHeader
          title="Portfolio"
          description="Turn your job photos into a public portfolio site that wins work."
        />
        <div className="mt-8 rounded-2xl border border-border bg-card/70 p-10 text-center">
          <Layers className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <p className="mt-3 text-sm text-muted-foreground">
            The Portfolio site is a Team plan feature.
          </p>
          <Button asChild className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to="/pricing">See Team plan</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 sm:p-10">
        <PageHeader title="Portfolio" />
        <div className="mt-8 rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm font-bold text-foreground">Couldn't load your portfolio</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">{error}</p>
          <Button className="mt-5" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // The service returns a null portfolio deliberately, so that a member who
  // cannot create one lands on an empty state rather than a red error box.
  // Without this branch the page dereferenced null and crashed instead.
  if (!data.portfolio) {
    return (
      <div className="p-6 sm:p-10">
        <PageHeader title="Portfolio" description="A shareable mini-site of your best work." />
        <div className="mt-8 rounded-2xl border border-border bg-card/70 p-10 text-center">
          <Globe className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <p className="mt-4 text-sm font-bold text-foreground">No portfolio site yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            An owner or admin on your team needs to set this up. Once they do, every project you
            publish will appear here.
          </p>
        </div>
      </div>
    );
  }

  const p = data.portfolio;
  // Fail OPEN on an older API that doesn't send the field yet: RLS blocks the
  // write anyway, so the worst case is a clear error toast - whereas failing
  // closed would show every owner a read-only site during a rolling deploy.
  const canEdit = data.canEdit ?? true;
  const siteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/p/${p.slug}` : `/p/${p.slug}`;

  // The guided build takes the whole page. Leaving the tabs and the publish bar
  // above it would put three other jobs on screen while asking one question,
  // which is the crowding this flow was written to undo.
  if (guided && canEdit) {
    return (
      <PortfolioSetupWizard
        portfolio={p}
        serviceTypes={data.serviceTypes}
        projectCount={data.showcases.length}
        published={p.published}
        publishing={publishing}
        onPublish={(v) => void togglePublished(v)}
        onSaved={patchPortfolio}
        onExit={() => {
          dismissSetup(p.id);
          setGuided(false);
        }}
        onGoToProjects={() => setTab("projects")}
      />
    );
  }

  return (
    <div className="px-6 pb-24 pt-6 sm:px-10 sm:pt-10">
      <PageHeader
        title="Portfolio"
        description="A shareable mini-site of your best work - one page per project, plus embeds for your own website."
        actions={
          <Button variant="outline" asChild disabled={!p.published}>
            <a href={siteUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" /> View site
            </a>
          </Button>
        }
      />

      <PublishBar
        published={p.published}
        publishing={publishing}
        canEdit={canEdit}
        siteUrl={siteUrl}
        onToggle={togglePublished}
      />

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList>
          <TabsTrigger value="site">
            <Globe className="mr-1.5 h-4 w-4" /> Site
          </TabsTrigger>
          <TabsTrigger value="projects">
            <Layers className="mr-1.5 h-4 w-4" /> Projects
          </TabsTrigger>
          <TabsTrigger value="embeds">
            <Code2 className="mr-1.5 h-4 w-4" /> Embeds
          </TabsTrigger>
        </TabsList>

        <TabsContent value="site" className="mt-6">
          {canEdit ? (
            <PortfolioSitePanel
              portfolio={p}
              serviceTypes={data.serviceTypes}
              projectCount={data.showcases.length}
              onSaved={patchPortfolio}
              onStartGuided={() => setGuided(true)}
            />
          ) : (
            <ReadOnlyNotice what="the site's branding and copy" />
          )}
        </TabsContent>

        <TabsContent value="projects" className="mt-6">
          <ShowcasesPanel
            portfolioSlug={p.slug}
            published={p.published}
            canEdit={canEdit}
            onCountsChanged={() => void load()}
          />
        </TabsContent>

        <TabsContent value="embeds" className="mt-6">
          {canEdit ? (
            <PortfolioEmbedsPanel
              portfolio={p}
              onEmbedKeyChanged={(embed_key) => patchPortfolio({ embed_key })}
            />
          ) : (
            <ReadOnlyNotice what="the website embed snippets" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Whether this person has already chosen the editor over the guided build.
 *
 * Kept in localStorage rather than on the portfolio row because it is a
 * per-person preference about a workflow, not a fact about the site: an admin
 * who skips the wizard should not decide that for their co-owner.
 */
const setupKey = (portfolioId: string) => `sitepix.portfolio-setup-dismissed.${portfolioId}`;

function isSetupDismissed(portfolioId: string): boolean {
  try {
    return window.localStorage.getItem(setupKey(portfolioId)) === "1";
  } catch {
    return false;
  }
}

function dismissSetup(portfolioId: string) {
  try {
    window.localStorage.setItem(setupKey(portfolioId), "1");
  } catch {
    /* Private browsing and blocked storage just mean the wizard offers itself again. */
  }
}

/**
 * The publish state gets its own band above the tabs rather than living in the
 * Site tab: "is my site live, and what's the link?" is the question people come
 * to this page to answer, and it should never be one tab-click away.
 */
function PublishBar({
  published,
  publishing,
  canEdit,
  siteUrl,
  onToggle,
}: {
  published: boolean;
  publishing: boolean;
  canEdit: boolean;
  siteUrl: string;
  onToggle: (v: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(siteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  return (
    <div
      className={cn(
        "mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border p-4 sm:p-5",
        published ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide",
          published ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground",
        )}
      >
        <span
          className={cn("h-1.5 w-1.5 rounded-full", published ? "bg-white" : "bg-muted-foreground")}
        />
        {published ? "Live" : "Draft"}
      </span>

      <div className="min-w-0 flex-1">
        {published ? (
          <a
            href={siteUrl}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm font-bold text-foreground hover:underline"
          >
            {siteUrl}
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "Your site isn't public yet. Publish to get a shareable link and turn on embeds."
              : "Your site isn't public yet. An owner or admin can publish it."}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {published && (
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy link"}
          </Button>
        )}
        {canEdit && (
          <label className="flex cursor-pointer items-center gap-2">
            <Switch checked={published} disabled={publishing} onCheckedChange={onToggle} />
            <span className="text-xs font-bold text-muted-foreground">Publish</span>
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * Shown in place of an editor a plain member may open but not use.
 *
 * The tab still exists rather than being hidden: "why can't I see Embeds?" is a
 * worse question than "why is this read-only?", and only one of them answers
 * itself. Writes are blocked by RLS regardless - this is the explanation, not
 * the enforcement.
 */
function ReadOnlyNotice({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center">
      <Lock className="mx-auto h-7 w-7 text-muted-foreground/60" />
      <p className="mt-3 text-sm font-bold text-foreground">Only owners and admins can edit this</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        Your team&rsquo;s portfolio is its public face, so changes to {what} are limited to owners
        and admins. You can still add and edit your own projects.
      </p>
    </div>
  );
}
