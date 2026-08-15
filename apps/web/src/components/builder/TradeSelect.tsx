import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CATEGORY_ORDER, GENERAL_CATEGORY, categoryIcon } from "@/lib/template-categories";

/**
 * Which trade a template is filed under, changed in place.
 *
 * Shared by the Checklists and Workflows builders, which are the same screen
 * twice and would otherwise carry the same dropdown twice. It sits among the
 * stat chips rather than behind a settings panel: changing which heading a
 * template appears under is a smaller act than opening a dialog for.
 *
 * A closed list, not free text. The strings have to match the ones the rail
 * groups by and the document library uses, or a typo silently creates a
 * heading with one template under it.
 *
 * `null` is a real choice and means General - where a template that belongs to
 * no particular trade sits, and which the rails deliberately put first because
 * it holds the team's own work.
 */
export function TradeSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const Icon = categoryIcon(value ?? GENERAL_CATEGORY);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-bold text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <Icon className="h-3 w-3" />
          {value ?? GENERAL_CATEGORY}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>File under</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {[GENERAL_CATEGORY, ...CATEGORY_ORDER].map((c) => {
          const RowIcon = categoryIcon(c);
          return (
            <DropdownMenuItem key={c} onSelect={() => onChange(c === GENERAL_CATEGORY ? null : c)}>
              <RowIcon className="mr-2 h-4 w-4" />
              {c}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
