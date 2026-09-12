import { createFileRoute, Link } from "@tanstack/react-router";
import { usePwaGuard } from "@/lib/pwa-guard";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Plus, ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HIDE_PUBLIC_PRICING } from "@/lib/pricing";

export const Route = createFileRoute("/faq")({
  component: FAQPage,
  head: () => ({
    meta: [
      { title: "FAQ - Everlumen" },
      {
        name: "description",
        content:
          "Answers to common questions about Everlumen - the job site photo, checklist, workflow, and reporting app built for contractors and field teams.",
      },
      { property: "og:title", content: "FAQ - Everlumen" },
      {
        property: "og:description",
        content: "Everything you need to know about Everlumen, from features to pricing.",
      },
      { property: "og:url", content: "https://www.everlumen.co/faq" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://www.everlumen.co/faq" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((q) => ({
            "@type": "Question",
            name: q.q,
            acceptedAnswer: { "@type": "Answer", text: q.a },
          })),
        }),
      },
    ],
  }),
});

const FAQS: { q: string; a: string }[] = [
  {
    q: "How is Everlumen different from just using my phone?",
    a: "Camera rolls and group chats lose photos. Everlumen files every photo on the right project automatically - timestamped, GPS-tagged and searchable - so you can find any moment from any job in seconds, even years later.",
  },
  {
    q: "What can the built-in AI do?",
    a: "It runs inside the features you already use, so there's no separate chatbot to learn. It analyzes photos, writes your daily log for you the moment you finish adding photos, drafts client-ready reports from a set of shots, narrates a recorded walkthrough into an AI Summary with a description of every photo you took along the way, and fills your document templates in from project data. Everything it writes is editable before you send it.",
  },
  {
    q: "Do I need a credit card to start?",
    // The fact being answered is "yes, a card is required", which holds either
    // way. Only the figure is withheld, so the answer stays truthful rather
    // than going vague about whether the product is paid at all.
    a: HIDE_PUBLIC_PRICING
      ? "Yes - every Everlumen plan, including Starter, is a paid subscription, so you'll add payment details when you sign up. You can cancel anytime from Settings."
      : "Yes - every Everlumen plan, including Starter, is a paid subscription starting at $24/mo, so you'll add payment details when you sign up. You can cancel anytime from Settings.",
  },
  {
    q: "Can I share photos with clients securely?",
    a: "Yes. Generate a client-ready gallery or report and share it via a secure link - no login required on their end, and you control exactly what's visible.",
  },
  {
    q: "Does it work offline on job sites?",
    a: "Yes. Capture photos, fill out checklists, and record walkthroughs without signal. Everything syncs automatically the moment you're back on network.",
  },
  {
    q: "Can I add or remove users as my crew changes?",
    a: "Absolutely. Invite or remove crew members any time, assign roles and permissions, and your plan adjusts automatically as your team changes size.",
  },
  {
    q: "Who owns the photos and data - can I export everything if I leave?",
    a: "You own everything you capture. Full project exports - photos, reports, and walkthroughs - are available any time from account settings, and stay available for a period after cancellation.",
  },
  {
    q: "Is a timestamped photo actually reliable enough to settle a dispute?",
    a: "Every photo carries its original capture time and GPS location, set automatically and not editable after the fact - that's what makes it a record your team can point to with confidence, not just a photo.",
  },
  {
    q: "What happens if I need to cancel?",
    a: "Cancel any time from account settings - no phone call or contract required. Your data stays exportable for a period afterward so you're never locked out of your own job record.",
  },
  {
    q: "Is there a free trial, and does it need a credit card?",
    a: "Every plan starts with a 14-day free trial, no credit card required. You'll only be asked for billing details if you decide to continue.",
  },
];

const FAQ_GROUPS = [
  {
    name: "Getting started",
    items: [
      "How is Everlumen different from just using my phone?",
      "Does it work offline on job sites?",
      "Do I need a credit card to start?",
      "Is there a free trial, and does it need a credit card?",
    ],
  },
  {
    name: "Using Everlumen",
    items: [
      "What can the built-in AI do?",
      "Can I share photos with clients securely?",
      "Is a timestamped photo actually reliable enough to settle a dispute?",
    ],
  },
  {
    name: "Security & data",
    items: ["Who owns the photos and data - can I export everything if I leave?"],
  },
  { name: "Billing & plans", items: ["What happens if I need to cancel?"] },
];

function FAQPage() {
  return (
    <div className="min-h-screen bg-background landing">
      <SiteHeader />

      {/* Header - the mockup navy hero band */}
      <section className="relative overflow-hidden bg-sidebar">
        <div className="relative mx-auto max-w-[820px] px-4 pt-[70px] pb-14 text-center sm:px-8">
          <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-brand-gold">
            FAQ
          </p>
          <h1 className="font-display mx-auto mt-4 text-[40px] font-bold leading-[1.04] tracking-[-0.01em] text-sidebar-foreground">
            Questions, answered.
          </h1>
        </div>
      </section>

      {/* FAQ accordion - the mockup category cards */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto flex max-w-[820px] flex-col items-center px-5">
          {FAQ_GROUPS.map((group, gi) => (
            <div key={group.name} className="w-full">
              <p
                className={cn(
                  "mb-[14px] text-[13px] font-bold uppercase tracking-[0.04em] text-accent-foreground",
                  gi > 0 && "mt-[44px]",
                )}
              >
                {group.name}
              </p>
              <AccordionPrimitive.Root
                type="single"
                collapsible
                defaultValue={`g${gi}-0`}
                className="overflow-hidden rounded-[18px] border border-border bg-card"
              >
                {group.items.map((q, qi) => {
                  const idx = FAQS.findIndex((f) => f.q === q);
                  const item = idx >= 0 ? FAQS[idx] : null;
                  if (!item) return null;
                  return (
                    <AccordionPrimitive.Item key={q} value={`g${gi}-${qi}`}>
                      <AccordionPrimitive.Header>
                        <AccordionPrimitive.Trigger className="group flex w-full items-center justify-between gap-6 px-6 py-[19px] text-left">
                          <span className="font-manrope text-[15px] font-semibold leading-snug text-foreground">
                            {item.q}
                          </span>
                          <span
                            aria-hidden
                            className="relative flex h-5 w-5 shrink-0 items-center justify-center"
                          >
                            <span className="text-[20px] font-medium leading-none text-faint group-data-[state=open]:opacity-0">
                              +
                            </span>
                            <span className="absolute inset-0 text-[20px] font-medium leading-none text-faint opacity-0 group-data-[state=open]:opacity-100">
                              {"\u2212"}
                            </span>
                          </span>
                        </AccordionPrimitive.Trigger>
                      </AccordionPrimitive.Header>
                      <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                        <p className="font-manrope px-6 pb-[19px] pt-3 text-[14px] leading-[1.6] text-muted-foreground">
                          {item.a}
                        </p>
                      </AccordionPrimitive.Content>
                    </AccordionPrimitive.Item>
                  );
                })}
              </AccordionPrimitive.Root>
            </div>
          ))}
        </div>
      </section>

      {/* Still have a question? - the mockup gold CTA */}
      <div className="py-16">
        <div className="mx-auto flex max-w-[820px] flex-col items-center px-5 text-center">
          <p className="font-manrope text-[15px] text-muted-foreground">Still have a question?</p>
          <Button
            asChild
            size="lg"
            className="font-manrope mt-6 rounded-full bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Link to="/signup">
              Start free trial <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
