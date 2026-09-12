import { useEffect } from "react";

/**
 * Renders the design-reference mockup (apps/web/public/Landing/Main.dc.html) as the
 * actual marketing page. The mockup is a self-contained React SPA shipped in
 * public/Landing, started through its own runtime, so embedding it is the only way
 * to show it exactly as authored - header, footer, nav, FAQ toggles and all.
 *
 * Children (any legacy marketing JSX a route still passes) are intentionally
 * ignored: only the mockup reaches the DOM.
 */
export function LandingMockup(props: { title: string; children?: unknown }) {
  useEffect(() => {
    document.title = props.title;
  }, [props.title]);

  return (
    <div className="h-screen w-full bg-background">
      <iframe
        src="/Landing/Main.dc.html"
        title={props.title}
        aria-label={props.title}
        className="h-full w-full border-0"
      />
    </div>
  );
}
