import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ShowcaseBuilder } from "@/components/portfolio/ShowcaseBuilder";
import { useAccountOwner } from "@/lib/use-access";
import { SkeletonList } from "@/ui";

/**
 * One portfolio page's builder, opened from the Portfolio's Projects tab.
 *
 * The same gate as the Portfolio itself: the account owner's screen and
 * nobody else's, including somebody who arrives by a link or a stale route.
 */
export default function ShowcaseBuilderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isOwner, isLoading } = useAccountOwner();
  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Portfolio page" }} />
        <SkeletonList rows={4} />
      </>
    );
  }
  if (!isOwner) return <Redirect href="/" />;
  if (!id) return <Redirect href="/portfolio" />;
  return <ShowcaseBuilder id={id} />;
}
