import { useState } from "react";
import { View } from "react-native";
import { docHtml, parseDoc, type DocBlock } from "@/api/rich-doc";
import { FormattedTextEditor } from "@/components/FormattedTextEditor";
import { spacing } from "@/theme";
import { Text } from "@/ui";

/**
 * A formatted text field over stored HTML, for the portfolio's long copy.
 *
 * The web edits the site's About, a page's opening and closing and each
 * section's words with its rich editor, and stores TipTap HTML. This is the
 * app's own `FormattedTextEditor` over that HTML, so bold, lists and links made
 * on either side survive the other. The blocks are held here, because parsing
 * the HTML again on every keystroke would give each block a new id and lose the
 * caret; `seed` changes when the stored value is replaced from outside (a
 * reload or a revert), which is the only time it is read again.
 */
export function RichHtmlField({
  label,
  hint,
  html,
  seed,
  placeholder,
  onChange,
}: {
  label?: string;
  hint?: string;
  html: string;
  seed: string | number;
  placeholder?: string;
  onChange: (html: string) => void;
}) {
  const [state, setState] = useState(() => ({ seed, blocks: parseDoc(html) }));
  let blocks: DocBlock[] = state.blocks;
  if (state.seed !== seed) {
    blocks = parseDoc(html);
    setState({ seed, blocks });
  }

  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Text variant="bodyStrong">{label}</Text> : null}
      {hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
      <FormattedTextEditor
        blocks={blocks}
        placeholder={placeholder}
        onChange={(next) => {
          setState({ seed, blocks: next });
          onChange(docHtml(next));
        }}
      />
    </View>
  );
}
