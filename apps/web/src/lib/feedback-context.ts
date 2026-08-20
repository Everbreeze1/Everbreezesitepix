/**
 * What machine was this reported from?
 *
 * The Feedback page used to ask people to type "the project, device, and steps
 * you were taking" into one freeform box, which meant the device half was
 * either missing, wrong, or a guess ("my phone"). Everything here is readable
 * from the browser, so nobody should be asked for it.
 *
 * Parsing is deliberately pure and input-driven: the caller passes the
 * navigator/screen values in, so this is unit-testable and safe to import in an
 * SSR pass. `readClientContext()` is the thin browser-reading wrapper.
 */

/*
 * A type alias, not an interface, on purpose: only an alias is assignable to
 * the generated `Json` column type for `issue_reports.client_info`. An
 * interface has no implicit index signature, so making this one would push a
 * cast into every insert.
 */
export type ClientContext = {
  /** "Chrome 141", "Safari 17". Falls back to "Unknown browser". */
  browser: string;
  /** "Windows", "iOS 17.2", "Android 14", "macOS 14.4". */
  os: string;
  /** "Desktop" | "Phone" | "Tablet". */
  device: string;
  /** Physical screen, "2560x1440". */
  screen: string;
  /** Browser viewport, "1280x800" - the one that explains a layout bug. */
  viewport: string;
  timezone: string;
  language: string;
  /** Kept verbatim as the tiebreaker when the parse above is wrong. */
  userAgent: string;
};

export interface ClientContextInput {
  userAgent?: string | null;
  language?: string | null;
  timezone?: string | null;
  screen?: { width?: number | null; height?: number | null } | null;
  viewport?: { width?: number | null; height?: number | null } | null;
  /** navigator.maxTouchPoints - the only way to spot an iPad, which reports itself as a Mac. */
  maxTouchPoints?: number | null;
}

const UNKNOWN = "Unknown";

/**
 * Ordered most-specific-first, because every one of these also claims to be
 * the ones below it: Edge says Chrome and Safari, Chrome says Safari.
 */
const BROWSERS: Array<{ test: RegExp; name: string }> = [
  { test: /Edg(?:e|A|iOS)?\/(\d+)/, name: "Edge" },
  { test: /OPR\/(\d+)/, name: "Opera" },
  { test: /SamsungBrowser\/(\d+)/, name: "Samsung Internet" },
  { test: /(?:Firefox|FxiOS)\/(\d+)/, name: "Firefox" },
  { test: /(?:Chrome|CriOS)\/(\d+)/, name: "Chrome" },
  { test: /Version\/(\d+)[\d.]*.*Safari/, name: "Safari" },
];

function parseBrowser(ua: string): string {
  for (const b of BROWSERS) {
    const m = ua.match(b.test);
    if (m) return m[1] ? `${b.name} ${m[1]}` : b.name;
  }
  return "Unknown browser";
}

function parseOs(ua: string): string {
  const ios = ua.match(/(?:iPhone|iPad|iPod).*?OS (\d+)[._](\d+)/);
  if (ios) return `iOS ${ios[1]}.${ios[2]}`;

  const android = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (android) return `Android ${android[1]}`;

  if (/CrOS/.test(ua)) return "ChromeOS";

  // NT 10.0 covers both Windows 10 and 11 - the UA cannot tell them apart, so
  // claiming either would be a coin flip stated as fact.
  if (/Windows NT 10/.test(ua)) return "Windows 10 or 11";
  if (/Windows NT 6\.3/.test(ua)) return "Windows 8.1";
  if (/Windows NT 6\.1/.test(ua)) return "Windows 7";
  if (/Windows/.test(ua)) return "Windows";

  const mac = ua.match(/Mac OS X (\d+)[._](\d+)/);
  if (mac) return `macOS ${mac[1]}.${mac[2]}`;
  if (/Macintosh/.test(ua)) return "macOS";

  if (/Linux/.test(ua)) return "Linux";
  return UNKNOWN;
}

function parseDevice(ua: string, maxTouchPoints: number): string {
  if (/iPad/.test(ua)) return "Tablet";
  // iPadOS 13+ ships a desktop Safari UA. Touch points is what separates it
  // from an actual Mac, which reports 0.
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return "Tablet";
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return "Tablet";
  if (/iPhone|iPod|Mobile|Windows Phone/.test(ua)) return "Phone";
  return "Desktop";
}

function dims(d: { width?: number | null; height?: number | null } | null | undefined): string {
  const w = Math.round(Number(d?.width ?? 0));
  const h = Math.round(Number(d?.height ?? 0));
  return w > 0 && h > 0 ? `${w}x${h}` : UNKNOWN;
}

export function describeClient(input: ClientContextInput): ClientContext {
  const ua = (input.userAgent ?? "").trim();
  return {
    browser: ua ? parseBrowser(ua) : "Unknown browser",
    os: ua ? parseOs(ua) : UNKNOWN,
    device: ua ? parseDevice(ua, Number(input.maxTouchPoints ?? 0)) : UNKNOWN,
    screen: dims(input.screen),
    viewport: dims(input.viewport),
    timezone: (input.timezone || "").trim() || UNKNOWN,
    language: (input.language || "").trim() || UNKNOWN,
    userAgent: ua.slice(0, 500),
  };
}

/** Reads the live browser. Returns a fully-Unknown context under SSR. */
export function readClientContext(): ClientContext {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return describeClient({});
  }
  let timezone = "";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    /* older engines, or a locked-down profile - the rest of the context still stands */
  }
  return describeClient({
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone,
    screen: { width: window.screen?.width, height: window.screen?.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

/**
 * The rows shown back to the user before they send, so "we attach your device
 * details" is something they can read rather than take on trust.
 */
export function clientContextRows(c: ClientContext): Array<{ label: string; value: string }> {
  return [
    { label: "Browser", value: c.browser },
    { label: "Operating system", value: c.os },
    { label: "Device", value: c.device },
    // A maximised window matches the screen exactly, and "1600x1000 (window
    // 1600x1000)" reads like a bug in the page that is supposed to receive them.
    {
      label: "Screen",
      value:
        c.viewport === UNKNOWN || c.viewport === c.screen
          ? c.screen
          : `${c.screen} (window ${c.viewport})`,
    },
    { label: "Time zone", value: c.timezone },
  ];
}

/** One-line form, for a toast or a triage list. */
export function summarizeClient(c: ClientContext): string {
  return [c.browser, c.os, c.device].filter((p) => p && p !== UNKNOWN).join(" · ");
}
