import { useState } from "react";
import { View } from "react-native";
import { createPlatformUser } from "@/api/admin";
import { CREATABLE_TEAM_ROLES, reasonError } from "@/api/admin-view";
import { openShareSheet } from "@/api/sharing";
import { spacing } from "@/theme";
import { Button, Chip, Field, Sheet, Text } from "@/ui";

/**
 * Creating an account from the console, as the web's CreateUserDialog does.
 *
 * Opened from Users it makes a bare account; opened from a team it adds the
 * new person to that team with a role, which the server only allows with a
 * note for the audit log. The server mails them a link to choose a password;
 * when mail fails, the one-shot link comes back and can be handed over.
 */
export function CreateUserSheet({
  visible,
  onClose,
  team,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  team?: { id: string; name: string };
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState<(typeof CREATABLE_TEAM_ROLES)[number]>("standard");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    email: string;
    emailSent: boolean;
    setupLink: string | null;
  } | null>(null);

  const reset = () => {
    setEmail("");
    setFullName("");
    setCompany("");
    setNote("");
    setError(null);
    setResult(null);
  };

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter the email address for the account.");
      return;
    }
    if (team && reasonError(note)) {
      setError("Adding someone to an existing team needs a note for the audit log.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createPlatformUser({
        email: email.trim(),
        fullName: fullName.trim() || undefined,
        company: company.trim() || undefined,
        team: team ? { teamId: team.id, role, overSeatLimit: false } : undefined,
        note: note.trim() || undefined,
      });
      setResult(created);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The account was not created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      title={team ? `Add a person to ${team.name}` : "Create an account"}
      subtitle="They are emailed a link to choose their own password."
    >
      {result ? (
        <View style={{ gap: spacing.lg }}>
          <Text variant="body">
            {result.emailSent
              ? `Account created. A set-password link was emailed to ${result.email}.`
              : `Account created, but the email to ${result.email} did not send.`}
          </Text>
          {!result.emailSent && result.setupLink ? (
            <Button
              label="Share the set-password link"
              variant="secondary"
              fullWidth
              onPress={() => void openShareSheet(result.setupLink!, "Set your password")}
            />
          ) : null}
          <Button
            label="Done"
            fullWidth
            onPress={() => {
              reset();
              onClose();
            }}
          />
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <Field label="Full name" value={fullName} onChangeText={setFullName} hint="Optional" />
          {team ? null : (
            <Field label="Company" value={company} onChangeText={setCompany} hint="Optional" />
          )}
          {team ? (
            <>
              <View style={{ gap: spacing.sm }}>
                <Text variant="caption" tone="muted">
                  Role in {team.name}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                  {CREATABLE_TEAM_ROLES.map((option) => (
                    <Chip
                      key={option}
                      label={option}
                      selected={role === option}
                      onPress={() => setRole(option)}
                    />
                  ))}
                </View>
              </View>
              <Field
                label="Note (recorded in the audit log)"
                value={note}
                onChangeText={setNote}
                placeholder="Ticket number, or who asked for this"
                multiline
                rows={2}
              />
            </>
          ) : null}
          {error ? (
            <Text variant="caption" tone="destructive">
              {error}
            </Text>
          ) : null}
          <Button
            label="Create account"
            fullWidth
            loading={busy}
            disabled={busy}
            onPress={() => void submit()}
          />
        </View>
      )}
    </Sheet>
  );
}
