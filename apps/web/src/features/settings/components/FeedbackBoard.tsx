import { useState } from "react";
import {
  AlertTriangle,
  Lightbulb,
  HelpCircle,
  ChevronUp,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REFERENCE_BUTTON_PRIMARY,
  REFERENCE_CARD,
  REFERENCE_CARD_PADDING,
  ReferencePill,
} from "@/components/ui/reference";

interface FeedbackItem {
  id: string;
  title: string;
  type: "bug" | "idea" | "question";
  author: string;
  date: string;
  votes: number;
  status: "open" | "in-review" | "planned" | "done";
}

const FEEDBACK_ITEMS: FeedbackItem[] = [
  {
    id: "1",
    title: "Delete workflow fails with a connection error",
    type: "bug",
    author: "Ajmal",
    date: "2 days ago",
    votes: 6,
    status: "open",
  },
  {
    id: "2",
    title: "Reports don't show which one is newest",
    type: "bug",
    author: "Gumaro Vazquez",
    date: "3 weeks ago",
    votes: 4,
    status: "done",
  },
  {
    id: "3",
    title: "Let us reorder checklists inside a blueprint",
    type: "idea",
    author: "Ajmal",
    date: "3 days ago",
    votes: 11,
    status: "in-review",
  },
  {
    id: "4",
    title: "Bulk-caption photos from one panel",
    type: "idea",
    author: "Jackson Brosgart",
    date: "1 week ago",
    votes: 9,
    status: "planned",
  },
  {
    id: "5",
    title: "Can a Manager delete a project, or only an Owner?",
    type: "question",
    author: "Kevin Dale Mergas",
    date: "5 days ago",
    votes: 2,
    status: "open",
  },
];

const FILTERS = [
  { key: "all", label: "All", count: 8 },
  { key: "bugs", label: "Bugs", count: 3 },
  { key: "ideas", label: "Ideas", count: 4 },
  { key: "questions", label: "Questions", count: 1 },
] as const;

export function FeedbackBoard() {
  const [filter, setFilter] = useState<"all" | "bugs" | "ideas" | "questions">("all");

  const filtered = FEEDBACK_ITEMS.filter(
    (item) => filter === "all" || item.type === filter.slice(0, -1)
  );

  const statusTone = (status: string) => {
    switch (status) {
      case "open": return "hold";
      case "in-review": return "review";
      case "planned": return "active";
      case "done": return "complete";
      default: return "hold";
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "open": return "Open";
      case "in-review": return "In review";
      case "planned": return "Planned";
      case "done": return "Done";
      default: return status;
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-10 pb-10 pt-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-5.5">
        <div>
          <div className="text-2xl font-bold tracking-[-0.01em] text-foreground">Feedback</div>
          <div className="mt-0.5 text-[13.5px] text-muted-foreground">
            Bugs, ideas and questions — yours and your crew's.
          </div>
        </div>
        <button className={REFERENCE_BUTTON_PRIMARY}>
          <Plus className="h-[15px] w-[15px]" />
          New feedback
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-[14px] py-[7px] text-[12.5px] font-semibold transition",
              filter === f.key
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label} <span className="font-mono text-[11px]">{f.count}</span>
          </button>
        ))}
      </div>

      {/* Feedback List */}
      <div className={cn(REFERENCE_CARD, "overflow-hidden")}>
        {filtered.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3.5 border-b border-border px-4.5 py-4 last:border-b-0"
          >
            {/* Upvote */}
            <div className="flex flex-col items-center gap-0.5 rounded-lg border border-border px-2.5 py-1.5 text-muted-foreground">
              <ChevronUp className="h-3 w-3" />
              <span className="font-mono text-[11px]">{item.votes}</span>
            </div>

            {/* Type Icon */}
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                item.type === "bug" ? "bg-red-100" : item.type === "idea" ? "bg-sky-100" : "bg-secondary"
              )}
            >
              {item.type === "bug" ? (
                <AlertTriangle className="h-4 w-4 text-red-600" />
              ) : item.type === "idea" ? (
                <Lightbulb className="h-4 w-4 text-sky-600" />
              ) : (
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              )}
            </div>

            {/* Content */}
            <div className="flex-grow">
              <div className="text-[13.5px] font-semibold text-foreground">{item.title}</div>
              <div className="mt-0.5 text-[11.5px] text-faint">
                {item.type.charAt(0).toUpperCase() + item.type.slice(1)} &middot; {item.author} &middot; {item.date}
              </div>
            </div>

            {/* Status */}
            <ReferencePill tone={statusTone(item.status) as "hold" | "review" | "active" | "complete"}>
              {statusLabel(item.status)}
            </ReferencePill>
          </div>
        ))}
      </div>
    </div>
  );
}