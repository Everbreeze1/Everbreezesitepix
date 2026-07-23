import { createFileRoute } from "@tanstack/react-router";
import { Camera, FolderTree, Users, ShieldCheck, FileText, ClipboardCheck } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { MarketingCta } from "@/components/MarketingCta";

export const Route = createFileRoute("/features")({
  component: FeaturesPage,
  head: () => ({
    meta: [
      { title: "Features — Everbreeze SitePix" },
      {
        name: "description",
        content:
          "Capture, organize, share, and report on job site photos — everything a field crew needs to document a build, and nothing it doesn't.",
      },
      { property: "og:title", content: "Features — Everbreeze SitePix" },
      {
        property: "og:description",
        content:
          "Capture, organize, share, and report on job site photos — everything a field crew needs to document a build, and nothing it doesn't.",
      },
      { property: "og:url", content: "https://everbreezesitepix.com/features" },
    ],
    links: [{ rel: "canonical", href: "https://everbreezesitepix.com/features" }],
  }),
});

const features = [
  {
    icon: Camera,
    title: "Capture in the field",
    desc: "Timestamped job site photos and videos with EXIF and GPS baked in. Snap it, and it is filed on the right project instantly.",
  },
  {
    icon: FolderTree,
    title: "Automatic organization",
    desc: "Projects, dates and locations sort themselves. Full history for every job so nothing ever gets lost again.",
  },
  {
    icon: Users,
    title: "Team collaboration",
    desc: "Shared workspaces, role-based permissions, task assignment and real-time updates keep the whole crew in sync.",
  },
  {
    icon: ShieldCheck,
    title: "Secure client sharing",
    desc: "Share polished, watermarked photo galleries with clients and stakeholders — without exposing your whole library.",
  },
  {
    icon: FileText,
    title: "Professional reports",
    desc: "Turn a day of photos into a branded, automated progress report. Breeze AI drafts it, you send it.",
  },
  {
    icon: ClipboardCheck,
    title: "Checklists & workflows",
    desc: "Standardized checklists and status updates across projects so quality and process stay consistent, job to job.",
  },
];

function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Header */}
      <section className="pt-32 pb-4 sm:pt-40">
        <div className="mx-auto max-w-[768px] px-5 text-center">
          <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
            Features
          </p>
          <h1 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.4px] text-foreground sm:text-5xl sm:tracking-[-1.8px] lg:text-[60px] lg:tracking-[-2.1px]">
            Everything the field needs,{" "}
            <span className="italic text-primary">nothing it doesn't.</span>
          </h1>
          <p className="font-manrope mx-auto mt-6 max-w-xl text-lg leading-[29px] text-muted-foreground">
            From the first photo to the final report, SitePix handles the documentation so your crew
            can stay focused on the build.
          </p>
        </div>
      </section>

      {/* Feature grid */}
      <section className="py-28">
        <div className="mx-auto max-w-[1280px] px-8">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-[32px] border-[0.8px] border-border bg-card/50 p-8"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                  <f.icon className="h-6 w-6 text-primary" />
                </span>
                <h3 className="font-display mt-6 text-2xl font-semibold leading-8 tracking-[-0.84px] text-foreground">
                  {f.title}
                </h3>
                <p className="font-manrope mt-3 text-base leading-[26px] text-muted-foreground">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <MarketingCta />
      <SiteFooter />
    </div>
  );
}
