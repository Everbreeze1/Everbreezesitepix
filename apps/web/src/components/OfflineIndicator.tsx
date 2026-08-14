import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Small banner that appears when the browser goes offline.
 * Auto-hides when the connection is restored.
 */
export function OfflineIndicator() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex animate-fade-in justify-center px-3 pt-[max(env(safe-area-inset-top),0.5rem)]"
    >
      <div className="flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive px-4 py-1.5 text-xs font-medium text-destructive-foreground shadow-lg">
        <WifiOff className="h-3.5 w-3.5" />
        You're offline - changes will sync when you reconnect
      </div>
    </div>
  );
}
