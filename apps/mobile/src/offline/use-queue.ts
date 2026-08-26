import { useEffect, useState } from "react";
import { queueSnapshot, subscribeToQueue } from "./sync";
import type { OutboxCounts } from "./outbox";

/** Live outbox counts. Re-renders whenever the drain changes something. */
export function useQueue(): OutboxCounts {
  const [counts, setCounts] = useState<OutboxCounts>(queueSnapshot);

  useEffect(() => subscribeToQueue(setCounts), []);

  return counts;
}
