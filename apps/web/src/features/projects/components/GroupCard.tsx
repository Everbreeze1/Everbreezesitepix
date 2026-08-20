import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { SURFACE_CARD_INTERACTIVE } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { FolderKanban, ImageOff } from "lucide-react";

interface Props {
  id: string;
  name: string;
  description?: string | null;
  projectCount: number;
  thumbnails: string[];
}

export function GroupCard({ id, name, description, projectCount, thumbnails }: Props) {
  const thumbs = thumbnails.slice(0, 4);
  return (
    <Link to="/groups/$groupId" params={{ groupId: id }} className="group block" preload="intent">
      {/* The house surface, so a group card sits in the same grid as the
          project cards beside it and opens a page that matches it. */}
      <Card className={cn(SURFACE_CARD_INTERACTIVE, "overflow-hidden p-0")}>
        <div className="relative grid aspect-[16/9] grid-cols-2 grid-rows-2 gap-0.5 bg-muted">
          {thumbs.length === 0 ? (
            <div className="col-span-2 row-span-2 flex flex-col items-center justify-center gap-1 text-muted-foreground">
              <ImageOff className="h-6 w-6 opacity-60" />
              <span className="text-[10px] uppercase tracking-wider">No photos</span>
            </div>
          ) : (
            Array.from({ length: 4 }).map((_, i) => {
              const url = thumbs[i];
              return (
                <div key={i} className="relative overflow-hidden bg-muted">
                  {url ? (
                    <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                </div>
              );
            })
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
            <p className="line-clamp-1 text-base font-semibold text-white">{name}</p>
            <p className="text-[11px] text-white/85">
              {projectCount} {projectCount === 1 ? "project" : "projects"}
            </p>
          </div>
          <div className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
            <FolderKanban className="h-3 w-3" />
            Group
          </div>
        </div>
        {description && (
          <div className="border-t border-border/60 bg-card p-3">
            <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
          </div>
        )}
      </Card>
    </Link>
  );
}
