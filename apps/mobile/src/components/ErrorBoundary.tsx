import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { palettes, radius, spacing, typography } from "@/theme/tokens";

type Props = {
  children: ReactNode;
  /** Reset hook, so a parent can clear the state that caused the throw. */
  onReset?: () => void;
};

type State = {
  error: Error | null;
};

/**
 * Catches render errors so a bad screen shows a recoverable message instead of
 * a white screen. In a release build an uncaught throw unmounts the whole tree,
 * and the only way out is force-quitting the app, which on a jobsite means
 * losing whatever was on screen.
 *
 * Error boundaries only catch errors during render, in lifecycle methods, and
 * in constructors below them. Event handlers and async work throw past this,
 * which is why data access goes through TanStack Query's error state instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Phase 7 replaces this with Sentry. Until then the trace at least reaches
    // the Metro console during development.
    console.error("[everlumen] render error", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <Text style={styles.title}>Something broke</Text>
        <Text style={styles.body}>
          The screen failed to load. Your queued photos and edits are saved and will still upload.
        </Text>

        {__DEV__ ? (
          <ScrollView style={styles.trace} contentContainerStyle={styles.traceContent}>
            <Text style={styles.traceText}>{error.stack ?? error.message}</Text>
          </ScrollView>
        ) : null}

        <Pressable accessibilityRole="button" style={styles.button} onPress={this.handleReset}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

/*
 * Module-scope styles cannot call hooks, so this uses the light palette. The
 * error screen is rare and short-lived, and a class component cannot read the
 * theme hook anyway.
 */
const colors = palettes.light;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
    justifyContent: "center",
    gap: spacing.md,
  },
  title: { ...typography.title, color: colors.foreground },
  body: { ...typography.body, color: colors.mutedForeground },
  trace: {
    maxHeight: 220,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  traceContent: { padding: spacing.md },
  traceText: { ...typography.caption, color: colors.mutedForeground, fontFamily: "monospace" },
  button: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  buttonText: { ...typography.bodyStrong, color: colors.primaryForeground },
});
