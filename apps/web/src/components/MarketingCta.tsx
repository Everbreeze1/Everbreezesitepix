import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import ctaImg from "@/assets/cta-construction.png";

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
                Start capturing a better record today. Plans start at $24/mo - pick the one that
                fits your crew and cancel anytime.
              </p>
            </div>
            <div className="flex w-[179px] shrink-0 flex-col items-start">
              <Link
                to="/signup"
                className="font-manrope inline-flex h-12 w-full items-center justify-center gap-2 rounded-3xl bg-sidebar px-6 text-sm font-bold leading-5 text-sidebar-foreground hover:bg-sidebar/90"
              >
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <ul className="mt-5 w-full">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-white/90" strokeWidth={1.33} />
                  <span className="font-manrope text-xs font-bold leading-4 text-white/90">
                    Plans from $24/mo
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
