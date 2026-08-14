import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { BrandLogo } from "./BrandLogo";

const DISMISS_KEY = "sitepix-app-download-dismissed-at";
const DISMISS_DAYS = 7;

function isMobileDevice() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  return mobileRegex.test(ua);
}

function isMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768;
}

function isInIframe() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

// The mobile app isn't published to either store yet (still an internal
// dev build) - keep this banner disabled rather than link to placeholder
// store listings. Re-enable once real App Store / Play Store URLs exist.
const MOBILE_APP_PUBLISHED = false;

export function MobileAppBanner() {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || !MOBILE_APP_PUBLISHED) return;

    const check = () => {
      if (!isMobileDevice() && !isMobileViewport()) {
        setHidden(true);
        return;
      }
      const dismissed = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      if (dismissed && Date.now() - dismissed < DISMISS_DAYS * 86400_000) {
        setHidden(true);
        return;
      }
      setHidden(false);
    };

    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setHidden(true);
  };

  if (hidden) return null;

  return (
    // z-10, not z-50: this banner is in normal flow inside <main>, below the
    // sticky AppHeader (z-20). At z-50 it slid over the header on scroll.
    <div className="relative z-10 w-full border-b border-border bg-background">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5 shrink-0">
          <BrandLogo size={40} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-foreground">
            Get the full experience. Download the Everbreeze SitePix app.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <a
              href="https://apps.apple.com/us/app/everbreeze-sitepix/id1234567890"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-card px-2.5 py-1.5 text-xs font-medium text-foreground ring-1 ring-border transition-colors hover:bg-muted active:scale-[0.97]"
            >
              <AppleIcon />
              App Store
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.everbreeze.sitepix"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-card px-2.5 py-1.5 text-xs font-medium text-foreground ring-1 ring-border transition-colors hover:bg-muted active:scale-[0.97]"
            >
              <AndroidIcon />
              Google Play
            </a>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function AppleIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993.0001.5511-.4482.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0225 3.503C15.5902 8.2439 13.8533 7.8502 12 7.8502c-1.8533 0-3.5902.3937-5.1369 1.0991L4.8406 5.4462a.416.416 0 00-.5676-.1521.416.416 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589.3432 18.6617h23.3136c0-4.0028-2.3457-7.475-5.7751-9.3403" />
    </svg>
  );
}
