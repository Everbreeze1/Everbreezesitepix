import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { TRIAL_DAYS } from "@/lib/pricing";

/**
 * Final CTA banner - matches the Landing reference: a gold gradient panel with a
 * soft white radial glow, the Oswald headline in navy, and the pill CTAs.
 */
export function MarketingCta() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-[1160px] px-4 sm:px-8">
        <div
          className="relative overflow-hidden rounded-[28px] px-6 py-16 text-center sm:px-12 md:py-16"
          style={{
            background: "linear-gradient(120deg, oklch(0.76 0.16 78), oklch(0.7 0.17 60))",
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 80% 0%, rgba(255,255,255,0.25), transparent 60%)",
            }}
          />

          <h2 className="font-display relative mx-auto max-w-[600px] text-[38px] font-bold leading-[1.04] tracking-[-0.01em] text-sidebar">
            Bring every job into focus.
          </h2>
          <p className="font-manrope relative mx-auto mt-4 max-w-[480px] text-[15.5px] leading-[1.6] text-sidebar/80">
            {`${TRIAL_DAYS}-day free trial. Set up in minutes. Cancel anytime.`}
          </p>
          <div className="relative mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/signup"
              className="font-manrope inline-flex items-center justify-center rounded-full bg-sidebar px-6 py-[13px] text-[14.5px] font-bold text-white transition-colors hover:bg-sidebar/90"
            >
              Start free trial <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
            <Link
              to="/demo"
              className="font-manrope inline-flex items-center justify-center rounded-full border-2 border-black/25 bg-transparent px-6 py-[12px] text-[14.5px] font-semibold text-sidebar transition-colors hover:bg-black/5"
            >
              See the interactive demo
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}