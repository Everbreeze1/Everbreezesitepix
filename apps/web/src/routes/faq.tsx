import { createFileRoute } from "@tanstack/react-router";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Plus } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { MarketingCta } from "@/components/MarketingCta";

export const Route = createFileRoute("/faq")({
  component: FAQPage,
  head: () => ({
    meta: [
      { title: "FAQ - Everbreeze SitePix" },
      {
        name: "description",
        content:
          "Answers to common questions about SitePix - the job site photo, checklist, workflow, and reporting app built for contractors and field teams.",
      },
      { property: "og:title", content: "FAQ - Everbreeze SitePix" },
      {
        property: "og:description",
        content: "Everything you need to know about SitePix, from features to pricing.",
      },
      { property: "og:url", content: "https://www.everbreezesitepix.com/faq" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://www.everbreezesitepix.com/faq" }],
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
    q: "How is SitePix different from just using my phone?",
    a: "Camera rolls and group chats lose photos. SitePix files every photo on the right project automatically - timestamped, GPS-tagged and searchable - so you can find any moment from any job in seconds, even years later.",
  },
  {
    q: "What can the built-in AI do?",
    a: "It runs inside the features you already use, so there's no separate chatbot to learn. It analyzes photos, writes your daily log for you the moment you finish adding photos, drafts client-ready reports from a set of shots, narrates a recorded walkthrough into an AI Summary with a description of every photo you took along the way, and fills your document templates in from project data. Everything it writes is editable before you send it.",
  },
  {
    q: "Do I need a credit card to start?",
    a: "Yes - every SitePix plan, including Starter, is a paid subscription starting at $24/mo, so you'll add payment details when you sign up. You can cancel anytime from Settings.",
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
];

function FAQPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Header */}
      <section className="pt-32 pb-4 sm:pt-40">
        <div className="mx-auto max-w-[768px] px-5 text-center">
          <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
            FAQ
          </p>
          <h1 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.4px] text-foreground sm:text-5xl sm:tracking-[-1.8px] lg:text-[60px] lg:tracking-[-2.1px]">
            The details, <span className="italic text-primary">up front.</span>
          </h1>
          <p className="font-manrope mx-auto mt-6 max-w-xl text-lg leading-[29px] text-muted-foreground">
            Everything you might want to know before you bring SitePix to your crew.
          </p>
        </div>
      </section>

      {/* FAQ accordion */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto flex max-w-[1280px] flex-col items-center px-5">
          <AccordionPrimitive.Root
            type="single"
            collapsible
            defaultValue="item-0"
            className="w-full max-w-[768px] divide-y divide-border border-y-[0.8px] border-border"
          >
            {FAQS.map((item, idx) => (
              <AccordionPrimitive.Item key={item.q} value={`item-${idx}`}>
                <AccordionPrimitive.Header>
                  <AccordionPrimitive.Trigger className="group flex w-full items-center justify-between gap-6 py-6 text-left">
                    <span className="font-display text-xl font-semibold leading-7 tracking-[-0.7px] text-foreground">
                      {item.q}
                    </span>
                    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-[0.8px] border-border transition-colors duration-200 group-data-[state=open]:border-primary group-data-[state=open]:bg-primary">
                      <Plus className="h-4 w-4 text-foreground transition-transform duration-200 group-data-[state=open]:rotate-45 group-data-[state=open]:text-primary-foreground" />
                    </span>
                  </AccordionPrimitive.Trigger>
                </AccordionPrimitive.Header>
                <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                  <p className="font-manrope max-w-[672px] pb-6 text-base leading-[26px] text-muted-foreground">
                    {item.a}
                  </p>
                </AccordionPrimitive.Content>
              </AccordionPrimitive.Item>
            ))}
          </AccordionPrimitive.Root>
        </div>
      </section>

      <MarketingCta />
      <SiteFooter />
    </div>
  );
}
