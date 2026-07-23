import { useEffect, useState } from "react";

const KEY = "sitepix:lastProjectId";

export function setLastProjectId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event("sitepix:lastProjectChanged"));
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
    window.addEventListener("sitepix:lastProjectChanged", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("sitepix:lastProjectChanged", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return id;
}
