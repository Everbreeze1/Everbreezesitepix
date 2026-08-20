import { describe, expect, it } from "vitest";
import {
  clientContextRows,
  describeClient,
  summarizeClient,
} from "../apps/web/src/lib/feedback-context";

/**
 * The Feedback page stopped asking people to type their device into the
 * narrative box and reads it instead, so these strings are what a triager sees
 * on every bug report. A wrong parse is worse than no parse: "Safari 17" on a
 * report filed from Chrome sends someone chasing the wrong renderer.
 */

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  operaWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  chromeAndroidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  chromeAndroidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  ipadOs:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
  samsung:
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
};

describe("browser", () => {
  it("names Chrome with its major version", () => {
    expect(describeClient({ userAgent: UA.chromeWindows }).browser).toBe("Chrome 141");
  });

  // Every one of these also claims to be Chrome, and Chrome claims to be
  // Safari, so the order of the checks is the whole test.
  it("prefers Edge over the Chrome it impersonates", () => {
    expect(describeClient({ userAgent: UA.edgeWindows }).browser).toBe("Edge 141");
  });

  it("prefers Opera over the Chrome it impersonates", () => {
    expect(describeClient({ userAgent: UA.operaWindows }).browser).toBe("Opera 125");
  });

  it("prefers Samsung Internet over the Chrome it impersonates", () => {
    expect(describeClient({ userAgent: UA.samsung }).browser).toBe("Samsung Internet 23");
  });

  it("reads Safari's version from Version/, not from Safari/", () => {
    expect(describeClient({ userAgent: UA.safariMac }).browser).toBe("Safari 17");
  });

  it("names Firefox", () => {
    expect(describeClient({ userAgent: UA.firefoxLinux }).browser).toBe("Firefox 128");
  });

  it("says so rather than guessing when the agent is unrecognised", () => {
    expect(describeClient({ userAgent: "curl/8.4.0" }).browser).toBe("Unknown browser");
  });
});

describe("operating system", () => {
  it("does not pick between Windows 10 and 11, which the agent cannot tell apart", () => {
    expect(describeClient({ userAgent: UA.chromeWindows }).os).toBe("Windows 10 or 11");
  });

  it("reads the iOS version", () => {
    expect(describeClient({ userAgent: UA.safariIphone }).os).toBe("iOS 17.4");
  });

  it("reads the Android version", () => {
    expect(describeClient({ userAgent: UA.chromeAndroidPhone }).os).toBe("Android 14");
  });

  it("reads the macOS version", () => {
    expect(describeClient({ userAgent: UA.safariMac }).os).toBe("macOS 10.15");
  });

  it("does not mistake Android for the Linux it is built on", () => {
    expect(describeClient({ userAgent: UA.chromeAndroidPhone }).os).not.toContain("Linux");
    expect(describeClient({ userAgent: UA.firefoxLinux }).os).toBe("Linux");
  });
});

describe("device", () => {
  it("calls a desktop a desktop", () => {
    expect(describeClient({ userAgent: UA.chromeWindows }).device).toBe("Desktop");
  });

  it("calls an iPhone a phone", () => {
    expect(describeClient({ userAgent: UA.safariIphone }).device).toBe("Phone");
  });

  it("splits Android on the Mobile token", () => {
    expect(describeClient({ userAgent: UA.chromeAndroidPhone }).device).toBe("Phone");
    expect(describeClient({ userAgent: UA.chromeAndroidTablet }).device).toBe("Tablet");
  });

  // iPadOS 13+ sends a desktop Safari agent. Touch points are the only signal
  // left, and without them a tablet layout bug is filed as a desktop one.
  it("separates an iPad from a Mac by touch points", () => {
    expect(describeClient({ userAgent: UA.ipadOs, maxTouchPoints: 5 }).device).toBe("Tablet");
    expect(describeClient({ userAgent: UA.ipadOs, maxTouchPoints: 0 }).device).toBe("Desktop");
  });
});

describe("dimensions and locale", () => {
  it("formats both sizes, since the viewport is what explains a layout bug", () => {
    const c = describeClient({
      userAgent: UA.chromeWindows,
      screen: { width: 2560, height: 1440 },
      viewport: { width: 1280.4, height: 800.6 },
    });
    expect(c.screen).toBe("2560x1440");
    expect(c.viewport).toBe("1280x801");
  });

  it("does not report a zero-sized screen as a measurement", () => {
    const c = describeClient({ userAgent: UA.chromeWindows, screen: { width: 0, height: 0 } });
    expect(c.screen).toBe("Unknown");
  });
});

describe("what the reporter is shown", () => {
  const c = describeClient({
    userAgent: UA.chromeWindows,
    screen: { width: 2560, height: 1440 },
    viewport: { width: 1280, height: 800 },
    timezone: "Europe/Warsaw",
    language: "en-GB",
  });

  it("summarises to one line", () => {
    expect(summarizeClient(c)).toBe("Chrome 141 · Windows 10 or 11 · Desktop");
  });

  // The page claims "see what we send", so the disclosure has to cover it.
  it("discloses every value it collects, with nothing blank", () => {
    const rows = clientContextRows(c);
    expect(rows.map((r) => r.label)).toEqual([
      "Browser",
      "Operating system",
      "Device",
      "Screen",
      "Time zone",
    ]);
    for (const row of rows) expect(row.value.trim()).not.toBe("");
    expect(rows.find((r) => r.label === "Screen")?.value).toBe("2560x1440 (window 1280x800)");
  });

  it("survives a browser that reports nothing at all", () => {
    const empty = describeClient({});
    expect(empty.browser).toBe("Unknown browser");
    expect(clientContextRows(empty)).toHaveLength(5);
  });
});

describe("screen row", () => {
  // A maximised window matches the screen, and repeating the same numbers reads
  // as a bug in the page whose job is receiving bug reports.
  it("does not repeat identical screen and window sizes", () => {
    const c = describeClient({
      userAgent: UA.chromeWindows,
      screen: { width: 1600, height: 1000 },
      viewport: { width: 1600, height: 1000 },
    });
    expect(clientContextRows(c).find((r) => r.label === "Screen")?.value).toBe("1600x1000");
  });
});
