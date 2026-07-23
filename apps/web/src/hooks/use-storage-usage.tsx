import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";

export interface StorageUsage {
  photoCount: number;
  bytesUsed: number;
  bytesLimit: number;
  photoLimit: number;
  bytesPct: number;
  photoPct: number;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useStorageUsage(): StorageUsage {
  const { user } = useAuth();
  const { limits } = useSubscription();
  const [photoCount, setPhotoCount] = useState(0);
  const [bytesUsed, setBytesUsed] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) {
      setPhotoCount(0);
      setBytesUsed(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ count }, { data: sumRow }] = await Promise.all([
      supabase
        .from("photos")
        .select("id", { count: "exact", head: true })
        .eq("uploaded_by", user.id),
      // sum via RPC-free trick: select small chunks and aggregate client-side would be costly,
      // so we use a head:true count plus a sum query via select on a view-less aggregate:
      supabase.from("photos").select("size_bytes.sum()").eq("uploaded_by", user.id).single(),
    ]);
    setPhotoCount(count ?? 0);
    const total = Number((sumRow as { sum?: number | string } | null)?.sum ?? 0);
    setBytesUsed(Number.isFinite(total) ? total : 0);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const photoLimit = Number.POSITIVE_INFINITY;
  const bytesLimit = limits.storageBytes;
  const bytesPct = bytesLimit > 0 ? Math.min(100, (bytesUsed / bytesLimit) * 100) : 0;
  const photoPct = 0;

  return { photoCount, bytesUsed, bytesLimit, photoLimit, bytesPct, photoPct, loading, reload };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}
