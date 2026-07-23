import { createFileRoute } from "@tanstack/react-router";
import { Crown } from "lucide-react";
import { toast } from "sonner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Upgrade — Everbreeze SitePix" },
      {
        name: "description",
        content: "Bring the whole crew into the record with the Everbreeze SitePix Team plan.",
      },
    ],
  }),
});

const STATS = [
  { value: "10", label: "team seats" },
  { value: "200 GB", label: "photo storage" },
  { value: "Unlimited", label: "AI scans" },
];

function PricingPage() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          <AppHeader />
          <main className="flex-1 min-w-0 p-10">
            <div className="relative overflow-hidden rounded-[32px] bg-sidebar p-12">
              <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-[640px]">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-ring">
                    <Crown className="h-6 w-6 text-sidebar-foreground" strokeWidth={2} />
                  </span>

                  <p className="font-manrope mt-9 text-xs font-extrabold uppercase tracking-[1.92px] text-sidebar-ring">
                    Everbreeze SitePix
                  </p>

                  <h1 className="font-display mt-4 text-[60px] font-bold leading-[49px] tracking-[-2.1px] text-sidebar-foreground">
                    Bring the whole crew into the record.
                  </h1>

                  <p className="font-manrope mt-6 max-w-[576px] text-base leading-7 text-sidebar-foreground/65">
                    Shared workspaces, permissions, advanced collaboration, live maps, and complete
                    project history for every job.
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      toast.info("Team plan upgrades coming soon", {
                        description: "We'll email you the moment Team plan upgrades go live.",
                      })
                    }
                    className="font-manrope mt-8 rounded-lg bg-sidebar-foreground px-6 py-3.5 text-sm font-bold text-sidebar transition-colors hover:bg-sidebar-foreground/90"
                  >
                    Explore Team plan
                  </button>
                </div>

                <div className="flex w-full flex-col gap-3 lg:mt-[82px] lg:w-[416px]">
                  {STATS.map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-2xl border-[0.8px] border-sidebar-border bg-sidebar-foreground/[0.06] p-4"
                    >
                      <p className="font-display text-[30px] font-bold leading-9 tracking-[-1.05px] text-sidebar-foreground">
                        {stat.value}
                      </p>
                      <p className="font-manrope mt-1 text-xs font-bold text-sidebar-foreground/55">
                        {stat.label}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
