import { useCallback, useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptInvite,
  acceptInviteSignup,
  acceptSubcontractorInvite,
  acceptSubcontractorInviteSignup,
  lookupInvite,
  lookupSubcontractorInvite,
  resendInviteConfirmation,
} from "@/api/invites";
import {
  inviteSignupProblem,
  RESEND_COOLDOWN_SECONDS,
  sameEmail,
  subcontractorInviteProblem,
  teamInviteProblem,
  teamInviteSummary,
} from "@/api/invite-view";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth";
import { goBack } from "@/lib/navigation";
import { supabase } from "@/lib/supabase";
import { spacing, useLayout, useTheme } from "@/theme";
import {
  ArrowRight,
  CircleCheck,
  HardHat,
  LogIn,
  LogOut,
  MailCheck,
  RefreshCw,
  TriangleAlert,
  Users,
  X,
} from "@/ui/icons";
import { Button, Card, EmptyState, Field, Icon, IconButton, SkeletonList, Text } from "@/ui";

/**
 * Accepting an invitation inside the app: the web's `/invite/<token>` and
 * `/subcontractor-invite/<token>` pages, on a phone.
 *
 * These screens sit outside the signed-in tree on purpose. Most invitees have
 * no account yet, and the form here is how they get one: the same public
 * `acceptInviteSignup` op the web page calls creates the account against the
 * invited address and takes the seat in one step. Somebody already signed in as
 * the invited address gets one button; somebody signed in as anybody else is
 * told so and offered a sign-out, because the server binds the invitation to
 * the address and would refuse them anyway.
 */

/** How long "You're in" shows before the app moves on, as on the web. */
const HANDOFF_MS = 900;

type Phase = "ready" | "confirm" | "accepted";

export function TeamInviteAccept({ token }: { token: string }) {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const lookup = useQuery({
    queryKey: ["invite-lookup", token],
    queryFn: () => lookupInvite(token),
    enabled: Boolean(token),
    retry: 1,
  });

  const [phase, setPhase] = useState<Phase>("ready");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(true);
  const [resending, setResending] = useState(false);
  const cooldown = useCountdown();

  const finish = useFinish();

  const invite = lookup.data?.invite ?? null;
  const teamName = lookup.data?.team?.name?.trim() || "the team";
  const problem = lookup.data ? teamInviteProblem(invite) : null;

  const acceptExisting = useCallback(async () => {
    setSubmitting(true);
    setMessage(null);
    try {
      await acceptInvite(token);
      setPhase("accepted");
      finish();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to accept invite");
    } finally {
      setSubmitting(false);
    }
  }, [token, finish]);

  const signupAndAccept = useCallback(async () => {
    if (!invite) return;
    const invalid = inviteSignupProblem({ fullName, password, confirmPassword });
    if (invalid) {
      setMessage(invalid);
      return;
    }
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await acceptInviteSignup({ token, fullName: fullName.trim(), password });
      /*
       * Past this line the account exists and the token is spent, so every
       * branch is terminal. Leaving them on the form would mean submitting it
       * again, which is guaranteed to come back "already used".
       */
      const email = res.email ?? invite.email;
      setConfirmEmail(email);
      let signErr: unknown = null;
      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        signErr = error;
      } catch (e) {
        signErr = e;
      }
      if (!signErr) {
        await queryClient.invalidateQueries();
        setPhase("accepted");
        finish();
        return;
      }
      const sent = res.confirmationEmailSent !== false;
      setConfirmationSent(sent);
      cooldown.start(sent ? RESEND_COOLDOWN_SECONDS : 0);
      setPhase("confirm");
    } catch (e) {
      // Nothing was created: the op releases its claim on failure, so the
      // invite is still open and the form is still the way in.
      setMessage(e instanceof Error ? e.message : "Could not complete signup");
    } finally {
      setSubmitting(false);
    }
  }, [invite, fullName, password, confirmPassword, token, queryClient, finish, cooldown]);

  const resend = useCallback(async () => {
    setResending(true);
    try {
      const res = await resendInviteConfirmation(token);
      if (res.alreadyConfirmed) {
        setConfirmationSent(true);
        setMessage("That address is already confirmed. You can sign in now.");
      } else if (res.emailSent) {
        setConfirmationSent(true);
        cooldown.start(RESEND_COOLDOWN_SECONDS);
        setMessage(null);
      } else {
        setConfirmationSent(false);
        setMessage("We still could not send it. Ask whoever invited you to resend from Team.");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not send that email");
    } finally {
      setResending(false);
    }
  }, [token, cooldown]);

  if (lookup.isLoading || authLoading) {
    return (
      <InviteFrame>
        <SkeletonList rows={4} />
      </InviteFrame>
    );
  }

  if (lookup.error || problem || !invite) {
    return (
      <InviteFrame>
        <Unavailable
          message={
            problem ??
            (lookup.error instanceof Error ? lookup.error.message : "Please ask for a new invite.")
          }
          onRetry={lookup.error ? () => void lookup.refetch() : undefined}
        />
      </InviteFrame>
    );
  }

  if (phase === "accepted") {
    return (
      <InviteFrame>
        <EmptyState icon={CircleCheck} title="You're in." body="Taking you to your projects." />
      </InviteFrame>
    );
  }

  if (phase === "confirm") {
    return (
      <InviteFrame>
        <View style={{ gap: spacing.lg }}>
          <Text variant="overline" tone="primary">
            One more step
          </Text>
          <Text variant="title">Confirm your email</Text>
          <Text variant="body" tone="muted">
            Your account is created and you have joined {teamName}. Confirm {confirmEmail} and you
            are in.
          </Text>
          {confirmationSent ? (
            <Text variant="body" tone="muted">
              We sent a confirmation link to that address. It usually arrives within a minute. Check
              your spam folder if you do not see it.
            </Text>
          ) : (
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
              <Icon icon={TriangleAlert} size="sm" tone="safety" />
              <Text variant="body" tone="safety" style={{ flex: 1 }}>
                We could not send the confirmation email just now. Your account and your place on
                the team are safe. Try again below.
              </Text>
            </View>
          )}
          {message ? <Notice text={message} /> : null}
          <Button
            label={
              resending
                ? "Sending"
                : cooldown.left > 0
                  ? `Resend confirmation email (${cooldown.left}s)`
                  : "Resend confirmation email"
            }
            icon={MailCheck}
            variant="outline"
            fullWidth
            loading={resending}
            disabled={resending || cooldown.left > 0}
            onPress={() => void resend()}
          />
          <Button
            label="Already confirmed? Sign in"
            icon={LogIn}
            variant="ghost"
            fullWidth
            onPress={() => router.replace("/login")}
          />
        </View>
      </InviteFrame>
    );
  }

  const summary = teamInviteSummary(invite.role, lookup.data?.tier ?? "starter", teamName);

  const intro = (
    <View style={{ gap: spacing.md }}>
      <Text variant="overline" tone="primary">
        Team invitation
      </Text>
      <Text variant="title">Join {teamName}.</Text>
      <Text variant="body" tone="muted">
        Your role will be {summary.roleLabel}. {summary.access}
      </Text>
      <Text variant="body" tone="muted">
        {summary.manage}
      </Text>
    </View>
  );

  return (
    <InviteFrame aside={intro}>
      <AcceptPanel
        user={user}
        invitedEmail={invite.email}
        submitting={submitting}
        message={message}
        acceptLabel={submitting ? "Joining" : `Accept and join ${teamName}`}
        signupLabel={submitting ? "Creating your account" : `Create account and join ${teamName}`}
        nameLabel="Full name"
        onAccept={() => void acceptExisting()}
        onSignup={() => void signupAndAccept()}
        fullName={fullName}
        password={password}
        confirmPassword={confirmPassword}
        onFullName={setFullName}
        onPassword={setPassword}
        onConfirmPassword={setConfirmPassword}
        signInPath={`/invite/${encodeURIComponent(token)}`}
      />
    </InviteFrame>
  );
}

export function SubcontractorInviteAccept({ token }: { token: string }) {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const finish = useFinish();

  const lookup = useQuery({
    queryKey: ["subcontractor-invite-lookup", token],
    queryFn: () => lookupSubcontractorInvite(token),
    enabled: Boolean(token),
    retry: 1,
  });

  const [accepted, setAccepted] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const data = lookup.data;
  const companyName = data?.teamName?.trim() || "a contractor";

  const acceptExisting = useCallback(async () => {
    setSubmitting(true);
    setMessage(null);
    try {
      await acceptSubcontractorInvite(token);
      setAccepted(`Taking you to your jobs for ${companyName}.`);
      finish();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not accept this invitation");
    } finally {
      setSubmitting(false);
    }
  }, [token, companyName, finish]);

  const signupAndAccept = useCallback(async () => {
    if (!data?.email) return;
    const invalid = inviteSignupProblem({ fullName, password, confirmPassword });
    if (invalid) {
      setMessage(invalid.replace("full name", "name"));
      return;
    }
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await acceptSubcontractorInviteSignup({
        token,
        fullName: fullName.trim(),
        password,
      });
      const { error } = await supabase.auth.signInWithPassword({ email: data.email, password });
      if (error) {
        // Created unconfirmed on purpose: say which of the two things happened.
        setAccepted(
          res.confirmationEmailSent === false
            ? `We could not send your confirmation email. Ask ${companyName} to invite you again.`
            : "Check your email to confirm your address, then sign in.",
        );
        return;
      }
      await queryClient.invalidateQueries();
      setAccepted(`Taking you to your jobs for ${companyName}.`);
      finish();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not complete signup");
    } finally {
      setSubmitting(false);
    }
  }, [data, fullName, password, confirmPassword, token, companyName, queryClient, finish]);

  if (lookup.isLoading || authLoading) {
    return (
      <InviteFrame>
        <SkeletonList rows={4} />
      </InviteFrame>
    );
  }

  if (lookup.error || !data?.valid || !data.email) {
    return (
      <InviteFrame>
        <Unavailable
          title="This link will not open"
          message={
            lookup.error instanceof Error
              ? lookup.error.message
              : subcontractorInviteProblem(data?.reason)
          }
          onRetry={lookup.error ? () => void lookup.refetch() : undefined}
        />
      </InviteFrame>
    );
  }

  if (accepted) {
    return (
      <InviteFrame>
        <EmptyState
          icon={CircleCheck}
          title="You're in"
          body={accepted}
          action={
            accepted.startsWith("Taking")
              ? undefined
              : { label: "Sign in", icon: LogIn, onPress: () => router.replace("/login") }
          }
        />
      </InviteFrame>
    );
  }

  const intro = (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Icon icon={HardHat} size="sm" tone="primary" />
        <Text variant="overline" tone="primary">
          Site access
        </Text>
      </View>
      <Text variant="title">{companyName} added you to a job.</Text>
      <Text variant="body" tone="muted">
        You'll be able to see the jobs they assigned you and add photos to them. You will not see
        their other projects, their team, or anything to do with billing.
      </Text>
    </View>
  );

  return (
    <InviteFrame aside={intro}>
      <AcceptPanel
        user={user}
        invitedEmail={data.email}
        submitting={submitting}
        message={message}
        acceptLabel={submitting ? "Getting you in" : "Accept and see the jobs"}
        signupLabel={submitting ? "Creating your login" : "Create login and continue"}
        nameLabel="Your name"
        onAccept={() => void acceptExisting()}
        onSignup={() => void signupAndAccept()}
        fullName={fullName}
        password={password}
        confirmPassword={confirmPassword}
        onFullName={setFullName}
        onPassword={setPassword}
        onConfirmPassword={setConfirmPassword}
        signInPath={`/subcontractor-invite/${encodeURIComponent(token)}`}
      />
    </InviteFrame>
  );
}

/**
 * The three shapes the action takes: accept (signed in as the invited
 * address), a sign-out (signed in as somebody else), or the signup form.
 */
function AcceptPanel(props: {
  user: { email?: string | null } | null;
  invitedEmail: string;
  submitting: boolean;
  message: string | null;
  acceptLabel: string;
  signupLabel: string;
  nameLabel: string;
  onAccept: () => void;
  onSignup: () => void;
  fullName: string;
  password: string;
  confirmPassword: string;
  onFullName: (v: string) => void;
  onPassword: (v: string) => void;
  onConfirmPassword: (v: string) => void;
  signInPath: string;
}) {
  const { signOut } = useAuth();
  const { user, invitedEmail } = props;

  if (user && sameEmail(user.email, invitedEmail)) {
    return (
      <View style={{ gap: spacing.lg }}>
        <Text variant="body" tone="muted">
          Signed in as {user.email}
        </Text>
        <Button
          label={props.acceptLabel}
          iconRight={ArrowRight}
          fullWidth
          loading={props.submitting}
          disabled={props.submitting}
          onPress={props.onAccept}
        />
        {props.message ? <Notice text={props.message} danger /> : null}
      </View>
    );
  }

  if (user) {
    return (
      <View style={{ gap: spacing.lg }}>
        <Notice
          danger
          text={`You're signed in as ${user.email ?? "another account"}, but this invitation is for ${invitedEmail}.`}
        />
        <Button
          label="Sign out and continue"
          icon={LogOut}
          variant="outline"
          fullWidth
          onPress={() => void signOut()}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.lg }}>
      {/* Fixed: the account is created against the invited address. */}
      <Field
        label="Email"
        value={invitedEmail}
        onChangeText={() => {}}
        editable={false}
        autoCapitalize="none"
      />
      <Field
        label={props.nameLabel}
        value={props.fullName}
        onChangeText={props.onFullName}
        placeholder="Jordan Smith"
        autoCapitalize="words"
        autoComplete="name"
        returnKeyType="next"
      />
      <Field
        label="Create password"
        value={props.password}
        onChangeText={props.onPassword}
        placeholder="At least 8 characters"
        secureTextEntry
        autoCapitalize="none"
        returnKeyType="next"
      />
      <Field
        label="Confirm password"
        value={props.confirmPassword}
        onChangeText={props.onConfirmPassword}
        placeholder="Re-enter your password"
        secureTextEntry
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={props.onSignup}
      />
      {props.message ? <Notice text={props.message} danger /> : null}
      <Button
        label={props.signupLabel}
        iconRight={ArrowRight}
        fullWidth
        loading={props.submitting}
        disabled={props.submitting}
        onPress={props.onSignup}
      />
      <Button
        label="I already have an account"
        icon={LogIn}
        variant="ghost"
        fullWidth
        onPress={() => router.push({ pathname: "/login", params: { redirect: props.signInPath } })}
      />
    </View>
  );
}

/**
 * The page: brand and a close button at the top, then the content.
 *
 * Upright it is one column. On a tablet or a phone on its side the intro sits
 * on the left and the form on the right, so the primary action is where the
 * right thumb is.
 */
function InviteFrame({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const side = layout.inset(spacing.lg);
  const twoUp = Boolean(aside) && (layout.rail || layout.tablet || layout.landscape);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: side,
          paddingBottom: spacing.sm,
        }}
      >
        <BrandMark size={32} />
        <IconButton
          icon={X}
          accessibilityLabel="Close"
          surface={false}
          onPress={() => goBack("/")}
        />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: side,
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
          flexDirection: twoUp ? "row" : "column",
          gap: twoUp ? spacing.xxl : spacing.xl,
        }}
      >
        {aside ? <View style={twoUp ? { flex: 1 } : undefined}>{aside}</View> : null}
        <View style={twoUp ? { flex: 1 } : undefined}>
          {twoUp ? <Card>{children}</Card> : children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Unavailable({
  title = "Invite unavailable",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={Users}
      title={title}
      body={message}
      action={
        onRetry
          ? { label: "Try again", icon: RefreshCw, onPress: onRetry }
          : { label: "Back to the app", onPress: () => goBack("/") }
      }
    />
  );
}

function Notice({ text, danger = false }: { text: string; danger?: boolean }) {
  return (
    <Text variant="caption" tone={danger ? "destructive" : "muted"}>
      {text}
    </Text>
  );
}

/** A seconds countdown for the resend button. */
function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  const start = useCallback((seconds: number) => setLeft(seconds), []);
  return { left, start };
}

/** After a successful accept: refresh everything the new membership changes, then go in. */
function useFinish() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries();
    setTimeout(() => router.replace("/(app)/(tabs)"), HANDOFF_MS);
  }, [queryClient]);
}
