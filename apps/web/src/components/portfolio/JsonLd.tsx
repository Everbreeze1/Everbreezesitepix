/**
 * Structured data for the portfolio site.
 *
 * Rendered inline rather than through the router's `head` so it is part of the
 * server-rendered markup on first paint — a crawler that does not execute JS
 * still sees it, which is the entire point of shipping it.
 *
 * `</script>` inside a JSON string would close this tag early, so the sequence
 * is escaped. Everything here is user-entered business data, so that matters.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
