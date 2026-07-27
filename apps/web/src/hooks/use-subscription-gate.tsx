import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useSubscription } from "@/hooks/use-subscription";

interface GateState {
  open: boolean;
  reason?: string;
}

interface SubscriptionGateContextValue {
  isActive: boolean;
  /** Run `fn` if the account has an active subscription; otherwise show the
   * upgrade dialog (optionally with a feature-specific `reason`) instead. */
  guard: (fn: () => void, reason?: string) => void;
  gateState: GateState;
  closeGate: () => void;
}

const SubscriptionGateContext = createContext<SubscriptionGateContextValue | null>(null);

export function SubscriptionGateProvider({ children }: { children: ReactNode }) {
  const { isActive } = useSubscription();
  const [gateState, setGateState] = useState<GateState>({ open: false });

  const guard = useCallback(
    (fn: () => void, reason?: string) => {
      if (isActive) {
        fn();
        return;
      }
      setGateState({ open: true, reason });
    },
    [isActive],
  );

  const closeGate = useCallback(() => setGateState((s) => ({ ...s, open: false })), []);

  const value = useMemo(
    () => ({ isActive, guard, gateState, closeGate }),
    [isActive, guard, gateState, closeGate],
  );

  return (
    <SubscriptionGateContext.Provider value={value}>{children}</SubscriptionGateContext.Provider>
  );
}

/** Guard mutating actions (create/upload/edit) behind an active subscription
 * from anywhere in the app — shows a shared upgrade dialog instead of
 * silently blocking or redirecting away from the page. */
export function useSubscriptionGate() {
  const ctx = useContext(SubscriptionGateContext);
  if (!ctx) {
    throw new Error("useSubscriptionGate must be used within a SubscriptionGateProvider");
  }
  return ctx;
}
