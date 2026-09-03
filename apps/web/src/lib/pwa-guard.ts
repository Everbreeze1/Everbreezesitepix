import { useEffect } from "react";

export function usePwaGuard() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(display-mode: standalone)").matches) {
      window.location.href = "/_app/dashboard";
    }
  }, []);
}
