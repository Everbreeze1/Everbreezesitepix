import { useCallback, useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { reasonError, deleteConfirmMatches } from "@/api/admin-view";
import { adminCan, type AdminCapability } from "@/lib/access";
import { usePlatformAdmin } from "@/lib/use-access";
import { radius, spacing, useTheme } from "@/theme";
import { Server } from "@/ui/icons";
import { Button, EmptyState, Field, Sheet, SkeletonList, Text } from "@/ui";

/**
 * The gate every admin screen sits behind.
 *
 * The same question the web's AdminLayout asks (`checkIsPlatformAdmin`), asked
 * before anything else on the screen mounts, so a non-admin who reaches an
 * admin route by hand triggers no admin op at all. The ops refuse them anyway;
 * this is so the screen says nothing either. Deliberately not "you are not
 * allowed": somebody who is not staff should learn nothing about what is here.
 */
export function AdminGate({ title, children }: { title: string; children: ReactNode }) {
  const { isAdmin, isLoading } = usePlatformAdmin();
  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Admin" }} />
        <SkeletonList rows={4} />
      </>
    );
  }
  if (!isAdmin) {
    return (
      <>
        <Stack.Screen options={{ title: "Admin" }} />
        <EmptyState icon={Server} title="Nothing here" body="This screen is for Everlumen staff." />
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title }} />
      {children}
    </>
  );
}

/**
 * What this admin may do, for deciding what to offer. Mirrors the web's
 * `useAdminRole`: an unknown role is allowed, and the server decides.
 */
export function useAdminCan() {
  const { role } = usePlatformAdmin();
  return {
    role,
    can: (capability: AdminCapability) => adminCan(role, capability),
    denyReason: (capability: AdminCapability) =>
      adminCan(role, capability)
        ? null
        : `Needs ${capability === "owner" ? "superadmin" : capability} access. Your admin role is ${role}.`,
  };
}

export type ReasonRequest = {
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** When set, the person must also type this address to confirm. */
  confirmEmail?: string | null;
  run: (reason: string, typedEmail: string) => Promise<unknown>;
};

/**
 * The reason prompt the web puts in front of every admin write.
 *
 * The reason is written to the audit log beside the action, so it is asked
 * for, not optional, and checked for length before the op is called.
 */
export function useReasonPrompt(onDone?: (error: string | null) => void) {
  const [request, setRequest] = useState<ReasonRequest | null>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback((next: ReasonRequest) => {
    setReason("");
    setTyped("");
    setError(null);
    setRequest(next);
  }, []);

  const confirm = async () => {
    if (!request) return;
    const bad = reasonError(reason);
    if (bad) {
      setError(bad);
      return;
    }
    if (request.confirmEmail !== undefined && !deleteConfirmMatches(request.confirmEmail, typed)) {
      setError("Type the account's email exactly to confirm.");
      return;
    }
    setBusy(true);
    try {
      await request.run(reason.trim(), typed.trim());
      setRequest(null);
      onDone?.(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const sheet = (
    <Sheet
      visible={request !== null}
      onClose={() => (busy ? undefined : setRequest(null))}
      title={request?.title}
      subtitle={request?.description}
    >
      <View style={{ gap: spacing.lg }}>
        <Field
          label="Reason (recorded in the audit log)"
          value={reason}
          onChangeText={(next) => {
            setReason(next);
            if (error) setError(null);
          }}
          placeholder="Ticket number, or what the customer asked for"
          multiline
          rows={2}
        />
        {request?.confirmEmail !== undefined ? (
          <Field
            label={`Type ${request?.confirmEmail ?? "the email"} to confirm`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        ) : null}
        {error ? (
          <Text variant="caption" tone="destructive">
            {error}
          </Text>
        ) : null}
        <Button
          label={request?.confirmLabel ?? "Continue"}
          variant={request?.destructive ? "destructive" : "primary"}
          fullWidth
          loading={busy}
          disabled={busy}
          onPress={() => void confirm()}
        />
      </View>
    </Sheet>
  );

  return { ask, sheet };
}

/** One number with its label, for the overview and the totals rows. */
export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexBasis: "47%",
        flexGrow: 1,
        padding: spacing.md,
        gap: 2,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
      }}
    >
      <Text variant="overline" tone="muted">
        {label.toUpperCase()}
      </Text>
      <Text variant="heading">{value}</Text>
      {note ? (
        <Text variant="caption" tone="muted">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** A wrapping row of stat tiles. */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{children}</View>
  );
}

/** Shown under a control this admin's role cannot use, so the reason is where the confusion is. */
export function CapabilityNotice({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <Text variant="caption" tone="muted">
      {reason}
    </Text>
  );
}

/** A value that settles after the person stops typing, for search boxes that query the server. */
export function useSettled<T>(value: T, delayMs = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
