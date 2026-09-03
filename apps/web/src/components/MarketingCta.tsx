import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, MonitorPlay } from "lucide-react";
import ctaImg from "@/assets/cta-construction.png";
import { HIDE_PUBLIC_PRICING, TRIAL_DAYS } from "@/lib/pricing";

export function MarketingCta() {
  return (
    <section className="bg-background py-24">
      <div className="mx-auto max-w-[1280px] px-8">
        <div className="relative isolate flex h-auto min-h-[328px] flex-col justify-center overflow-hidden rounded-[32px] bg-[#2584F4] px-8 py-16 sm:px-16 sm:py-20 lg:h-[328px] lg:py-0">
          <img
            src={ctaImg}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover brightness-125 contrast-110"
          />
          <div className="pointer-events-none absolute inset-0 bg-[#2584F4] mix-blend-color" />
          <div className="pointer-events-none absolute inset-0 bg-[#2584F4]/15" />
          <div className="relative flex w-full flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-[681px]">
              <p className="font-manrope text-xs font-extrabold uppercase leading-4 tracking-[1.92px] text-white/75">
                Ready when your crew is
              </p>
              <h2 className="font-display mt-4 max-w-[672px] text-4xl font-black uppercase leading-none tracking-[-2.1px] text-white sm:text-5xl lg:text-[60px]">
                Bring every job into focus.
              </h2>
              <p className="font-manrope mt-5 max-w-[576px] text-base font-medium leading-7 text-white/85">
                {HIDE_PUBLIC_PRICING
                  ? "Start capturing a better record today. Pick the plan that fits your crew and cancel anytime."
                  : "Start capturing a better record today. Plans start at $24/mo - pick the one that fits your crew and cancel anytime."}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-3">
              <Link
                to="/signup"
                className="font-manrope inline-flex h-12 w-full items-center justify-center gap-2 rounded-3xl bg-sidebar px-6 text-sm font-bold leading-5 text-sidebar-foreground hover:bg-sidebar/90"
              >
                Start documenting your jobs
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/how-it-works"
                className="font-manrope inline-flex h-12 w-full items-center justify-center gap-2 rounded-3xl border border-white/30 bg-transparent px-6 text-sm font-bold leading-5 text-white hover:bg-white/10"
              >
                See how it works
              </Link>
              <Link
                to="/demo"
                className="font-manrope inline-flex h-12 w-full items-center justify-center gap-2 rounded-3xl border border-white/30 bg-transparent px-6 text-sm font-bold leading-5 text-white hover:bg-white/10"
              >
                <MonitorPlay className="h-4 w-4" />
                See the interactive demo
              </Link>
              <ul className="mt-2 w-full">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-white/90" strokeWidth={1.33} />
                  <span className="font-manrope text-xs font-bold leading-4 text-white/90">
                    {/* The trial is the other half of the same promise, so it
                        keeps the pair of ticks intact rather than leaving one
                        lonely bullet where the price used to be. */}
                    {HIDE_PUBLIC_PRICING ? `${TRIAL_DAYS}-day free trial` : "Plans from $24/mo"}
                  </span>
                </li>
                <li className="mt-2 flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-white/90" strokeWidth={1.33} />
                  <span className="font-manrope text-xs font-bold leading-4 text-white/90">
                    Cancel anytime
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
