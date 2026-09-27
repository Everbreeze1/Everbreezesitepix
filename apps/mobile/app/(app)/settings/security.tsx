import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { changeMyEmail, changeMyPassword, passwordProblem, MIN_PASSWORD } from "@/api/profile";
import { useAuth } from "@/lib/auth";
import { spacing } from "@/theme";
import { KeyRound, Lock, Mail } from "@/ui/icons";
import { Button, Field, Screen, SectionHeader, Text } from "@/ui";

/**
 * Sign-in details: the web Settings page's Security section.
 *
 * Both go through Supabase auth directly, as the web does. An email change is
 * not done when the call returns: a confirmation goes to the new address and
 * the change takes effect when it is followed, so the screen says exactly that
 * rather than "saved". A password change is immediate.
 *
 * Accounts that signed in with Google or Apple can still set a password here;
 * it adds a way in rather than replacing the one they have.
 */
export default function SecurityScreen() {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [emailNote, setEmailNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [passwordNote, setPasswordNote] = useState<{ ok: boolean; text: string } | null>(null);

  const current = (user?.email ?? "").trim().toLowerCase();
  const nextEmail = email.trim().toLowerCase();
  const emailChanged = nextEmail.length > 0 && nextEmail !== current;
  const emailLooksWrong = emailChanged && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail);

  const emailMutation = useMutation({
    mutationFn: () => changeMyEmail(nextEmail),
    onMutate: () => setEmailNote(null),
    onSuccess: () =>
      setEmailNote({
        ok: true,
        text: `Check ${nextEmail} for a confirmation link. Your email changes once it is followed.`,
      }),
    onError: (e) =>
      setEmailNote({ ok: false, text: e instanceof Error ? e.message : "Could not change email" }),
  });

  const problem = password || confirm ? passwordProblem(password, confirm) : null;

  const passwordMutation = useMutation({
    mutationFn: () => changeMyPassword(password),
    onMutate: () => setPasswordNote(null),
    onSuccess: () => {
      setPassword("");
      setConfirm("");
      setPasswordNote({ ok: true, text: "Password updated." });
    },
    onError: (e) =>
      setPasswordNote({
        ok: false,
        text: e instanceof Error ? e.message : "Could not change password",
      }),
  });

  return (
    <Screen scroll bottomInset={spacing.xxl}>
      <SectionHeader title="Email address" />
      <Field
        label="Email"
        value={email}
        onChangeText={(next) => {
          setEmail(next);
          setEmailNote(null);
        }}
        icon={Mail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        hint="We confirm any change at the new address."
        error={emailLooksWrong ? "That does not look like an email address" : undefined}
      />
      {emailNote ? (
        <Text variant="caption" tone={emailNote.ok ? "success" : "destructive"}>
          {emailNote.text}
        </Text>
      ) : null}
      <Button
        label="Change email"
        variant="secondary"
        fullWidth
        disabled={!emailChanged || emailLooksWrong}
        loading={emailMutation.isPending}
        onPress={() => emailMutation.mutate()}
      />

      <SectionHeader title="Password" />
      <Field
        label="New password"
        value={password}
        onChangeText={(next) => {
          setPassword(next);
          setPasswordNote(null);
        }}
        icon={Lock}
        secureTextEntry
        autoCapitalize="none"
        hint={`At least ${MIN_PASSWORD} characters.`}
      />
      <Field
        label="Confirm new password"
        value={confirm}
        onChangeText={(next) => {
          setConfirm(next);
          setPasswordNote(null);
        }}
        icon={KeyRound}
        secureTextEntry
        autoCapitalize="none"
        error={confirm ? (problem ?? undefined) : undefined}
      />
      {passwordNote ? (
        <Text variant="caption" tone={passwordNote.ok ? "success" : "destructive"}>
          {passwordNote.text}
        </Text>
      ) : null}
      <Button
        label="Update password"
        fullWidth
        disabled={!password || Boolean(problem)}
        loading={passwordMutation.isPending}
        onPress={() => passwordMutation.mutate()}
      />
    </Screen>
  );
}
