import { useEffect, useState } from "react";

const KEY = "everlumen:lastProjectId";

export function setLastProjectId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event("everlumen:lastProjectChanged"));
  } catch {
    /* ignore */
  }
}

export function useLastProjectId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        setId(localStorage.getItem(KEY));
      } catch {
        setId(null);
      }
    };
    read();
    const onChange = () => read();
    window.addEventListener("everlumen:lastProjectChanged", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("everlumen:lastProjectChanged", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return id;
}
