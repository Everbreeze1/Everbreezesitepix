// Loads the Google Maps JS API (Places library) on demand for browser use.

declare global {
  interface Window {
    google?: any;
    __initGoogleMaps?: () => void;
  }
}

let loadingPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!key) return Promise.reject(new Error("Google Maps browser key missing"));

  loadingPromise = new Promise<void>((resolve, reject) => {
    window.__initGoogleMaps = () => resolve();
    const params = new URLSearchParams({
      key,
      loading: "async",
      libraries: "places",
      callback: "__initGoogleMaps",
    });
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      loadingPromise = null;
      reject(new Error("Failed to load Google Maps"));
    };
    document.head.appendChild(s);
  });
  return loadingPromise;
}
