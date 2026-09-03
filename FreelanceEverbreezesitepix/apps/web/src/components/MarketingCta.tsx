<div className="flex shrink-0 flex-col items-start gap-3">
  <Link
    to="/signup"
    className="font-manrope inline-flex h-12 w-full items-center justify-center gap-2 rounded-3xl bg-sidebar px-6 text-sm font-bold leading-5 text-sidebar-foreground hover:bg-sidebar/90"
  >
    Start Your Job Journey
    <ArrowRight className="h-4 w-4" />
  </Link>
  <Link
    to="/how-it-works"
    className="font-manrope inline-flex h-12 w-full items-center justify-center gap-2 rounded-3xl border border-white/30 bg-transparent px-6 text-sm font-bold leading-5 text-white hover:bg-white/10"
  >
    See how it works
  </Link>
  <ul className="mt-2 w-full">
    <li className="flex items-center gap-2">
      <Check className="h-4 w-4 shrink-0 text-white/90" strokeWidth={1.33} />
      <span className="font-manrope text-xs font-bold leading-4 text-white/90">
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