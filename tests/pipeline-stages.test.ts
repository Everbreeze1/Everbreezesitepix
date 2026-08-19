import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_PIPELINE_STAGES,
  MAX_PIPELINE_STAGES,
  nextPipelineStageColor,
  normalizePipelineName,
  pipelineNameBlocks,
  pipelineNameIssue,
  pipelineNameMessage,
  samePipelineName,
} from "../packages/shared/src/pipeline-stages";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const MIGRATION = read("supabase/migrations/20260917000000_pipeline_stages.sql");
const DROP_TAGS = read("supabase/migrations/20260918000000_project_boards_drop_tag_ids.sql");
const TEAM_SCOPE = read("supabase/migrations/20260920000000_pipeline_stage_team_scope.sql");
const API = read("apps/api/src/domains/projects/boards.ts");
const BOARD_VIEW = read("apps/web/src/features/projects/components/PipelineBoardView.tsx");
const STAGE_EDITOR = read("apps/web/src/features/projects/components/PipelineStageEditor.tsx");
const CREATE_DIALOG = read("apps/web/src/features/projects/components/CreateBoardDialog.tsx");
const SETTINGS_SHEET = read("apps/web/src/features/projects/components/BoardSettingsSheet.tsx");
const ADD_DIALOG = read("apps/web/src/features/projects/components/AddProjectToStageDialog.tsx");
const PROJECTS_PAGE = read("apps/web/src/features/projects/pages/ProjectsPage.tsx");
const STAGE_CHIP = read("apps/web/src/features/projects/components/ProjectStageChip.tsx");
const TAB_STRIP = read("apps/web/src/features/projects/components/PipelineTabStrip.tsx");
const DETAIL_PAGE = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");

/**
 * A stage is a field, not a tag.
 *
 * The pipelines that shipped first were saved tag selections: each tag in
 * `project_boards.tag_ids` drew a column, and a project appeared in every
 * column whose tag it carried. The client's review named both consequences.
 * A job stood in three columns of one board at once, because tags are
 * many-per-project by construction. And a board being nothing but a list of tag
 * ids meant a second board under a near-identical name was a normal accident.
 *
 * These tests pin the replacement: one scalar `projects.pipeline_stage_id`,
 * stages owned by the board, and no path anywhere from a tag to a column.
 */
describe("pipeline stages", () => {
  describe("the default stage set", () => {
    it("is the set the client asked to ship with, in order", () => {
      expect(DEFAULT_PIPELINE_STAGES.map((s) => s.name)).toEqual([
        "Lead/Quoted",
        "Scheduled",
        "In Progress",
        "Completed",
        "Invoiced",
        "Paid",
      ]);
    });

    it("matches the list the migration seeds, name for name and colour for colour", () => {
      // Two copies of a default is one copy plus a future disagreement. The SQL
      // needs its own because a board whose tags had all been deleted is seeded
      // by the migration, before any TypeScript runs.
      const block = MIGRATION.match(
        /CROSS JOIN \(\s*VALUES([\s\S]*?)\) AS d\(name, color, position\)/,
      );
      expect(block, "the migration's default VALUES list").toBeTruthy();
      const seeded = [...block![1].matchAll(/\('([^']+)',\s*'(#[0-9a-f]{6})',\s*(\d+)\)/gi)].map(
        (m) => ({ name: m[1], color: m[2], position: Number(m[3]) }),
      );
      expect(seeded).toEqual(
        DEFAULT_PIPELINE_STAGES.map((s, i) => ({ name: s.name, color: s.color, position: i })),
      );
    });

    it("gives every stage a distinct, readable hex colour", () => {
      const colors = DEFAULT_PIPELINE_STAGES.map((s) => s.color);
      expect(new Set(colors).size).toBe(colors.length);
      for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("keeps no two default colours close enough to be confused on a chip", () => {
      // Completed and Paid were both greens (#10b981 and #16a34a) and were not
      // tellable apart in a 12px pill, which is the size the colour is actually
      // read at. Distance in plain RGB is enough to catch that class of clash.
      const rgb = (hex: string) => {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      for (const a of DEFAULT_PIPELINE_STAGES) {
        for (const b of DEFAULT_PIPELINE_STAGES) {
          if (a.name >= b.name) continue;
          const [ar, ag, ab] = rgb(a.color);
          const [br, bg, bb] = rgb(b.color);
          const distance = Math.hypot(ar - br, ag - bg, ab - bb);
          expect(distance, `${a.name} (${a.color}) vs ${b.name} (${b.color})`).toBeGreaterThan(60);
        }
      }
    });

    it("cycles rather than running out when stages are added past the palette", () => {
      expect(nextPipelineStageColor(0)).toBe(nextPipelineStageColor(10));
      expect(nextPipelineStageColor(3)).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  describe("two names are the same name when only case, spacing or punctuation differ", () => {
    it("collapses the shapes that produced the accidental duplicate boards", () => {
      expect(samePipelineName("Kitchen Remodels", "kitchen remodels")).toBe(true);
      expect(samePipelineName("Kitchen Remodels", "Kitchen-Remodels")).toBe(true);
      expect(samePipelineName("Kitchen Remodels", "  KITCHEN  REMODELS  ")).toBe(true);
      expect(normalizePipelineName("Lead/Quoted")).toBe("leadquoted");
    });

    it("still tells genuinely different pipelines apart", () => {
      expect(samePipelineName("Install Jobs", "Service Calls")).toBe(false);
      expect(samePipelineName("Kitchen Remodels", "Kitchen Remodel")).toBe(false);
    });

    it("uses the same rule the database's unique indexes use", () => {
      // If the client rule and the index rule drift, the UI accepts a name and
      // Postgres then rejects it with a constraint violation.
      const sqlRule = "lower(regexp_replace(name, '[^[:alnum:]]', '', 'g'))";
      expect(MIGRATION).toContain(
        `CREATE UNIQUE INDEX IF NOT EXISTS project_boards_team_normalized_name_key\n  ON public.project_boards (team_id, ${sqlRule})`,
      );
      expect(MIGRATION).toContain(
        `CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_board_normalized_name_key\n  ON public.pipeline_stages (board_id, ${sqlRule})`,
      );
    });
  });

  describe("naming a pipeline", () => {
    const context = {
      otherPipelineNames: ["Install Jobs"],
      tagNames: ["Kitchen Remodel", "urgent"],
      projectNames: ["12 Oak Street"],
    };

    it("refuses a second pipeline with an existing name", () => {
      const issue = pipelineNameIssue("install jobs", context);
      expect(issue).toEqual({ kind: "duplicate", existing: "Install Jobs" });
      expect(pipelineNameBlocks(issue)).toBe(true);
      expect(pipelineNameMessage(issue!)).toContain("already exists");
    });

    it("warns, but does not block, when the name is a tag or a job", () => {
      // "Name each pipeline after the process it represents, not a customer,
      // job, or location" is a rule about intent, and intent is not decidable
      // from a string. Say it and let the person decide.
      const tagIssue = pipelineNameIssue("Kitchen-Remodel", context);
      expect(tagIssue?.kind).toBe("tag");
      expect(pipelineNameBlocks(tagIssue)).toBe(false);
      expect(pipelineNameMessage(tagIssue!)).toContain("tag filter");

      const projectIssue = pipelineNameIssue("12 Oak Street", context);
      expect(projectIssue?.kind).toBe("project");
      expect(pipelineNameBlocks(projectIssue)).toBe(false);
    });

    it("blocks an empty name and accepts a process name", () => {
      expect(pipelineNameBlocks(pipelineNameIssue("   ", context))).toBe(true);
      expect(pipelineNameIssue("Service Calls", context)).toBeNull();
    });
  });

  describe("the migration", () => {
    it("puts one scalar stage on the project, not a second join table", () => {
      expect(MIGRATION).toContain("ADD COLUMN IF NOT EXISTS pipeline_stage_id uuid");
      expect(MIGRATION).toMatch(/REFERENCES public\.pipeline_stages\(id\) ON DELETE SET NULL/);
      // CASCADE here would delete jobs when a column was removed.
      expect(MIGRATION).not.toMatch(/pipeline_stages\(id\) ON DELETE CASCADE/);
    });

    it("carries each existing board's tags across as real stages", () => {
      expect(MIGRATION).toContain("unnest(b.tag_ids) WITH ORDINALITY");
      expect(MIGRATION).toContain("INSERT INTO public.pipeline_stages");
    });

    it("gives a project that was in several columns the furthest one it reached", () => {
      // A job tagged both Scheduled and Invoiced is an invoiced job.
      expect(MIGRATION).toContain("ORDER BY b.created_at, b.id, ps.position DESC");
      expect(MIGRATION).toContain("AND p.pipeline_stage_id IS NULL");
    });

    it("only places a project on a board its own team owns", () => {
      /*
       * `public.tags` has no team_id - `ensureGlobalTag` writes one shared
       * vocabulary for the whole install. So a tag id listed in one team's
       * board matches project_tags rows from every other team that ever used
       * the same tag, and without a team join the backfill puts strangers'
       * projects on the board. It shipped that way once and moved 12 of 13
       * projects onto the wrong board; 20260920000000 cleans that up.
       */
      expect(MIGRATION).toContain("JOIN public.projects proj ON proj.id = pt.project_id");
      expect(MIGRATION).toContain("AND tm.user_id = proj.created_by");
      expect(TEAM_SCOPE).toContain("SET pipeline_stage_id = NULL");
      expect(TEAM_SCOPE).toContain("JOIN public.team_members tm ON tm.team_id = b.team_id");
    });

    it("merges the boards that were accidental duplicates of each other", () => {
      expect(MIGRATION).toContain("HAVING count(*) > 1");
      expect(MIGRATION).toContain("DELETE FROM public.project_boards WHERE id = dup.dup_id");
      // Projects in a duplicate's column are re-pointed, never dropped.
      expect(MIGRATION).toContain(
        "UPDATE public.projects SET pipeline_stage_id = target WHERE pipeline_stage_id = stg.id",
      );
    });

    it("does not leave a stage pointing back at a tag", () => {
      expect(MIGRATION).toContain(
        "ALTER TABLE public.pipeline_stages DROP COLUMN IF EXISTS legacy_tag_id",
      );
    });

    it("refuses to drop tag_ids before the stages exist", () => {
      expect(DROP_TAGS).toContain("ALTER TABLE public.project_boards DROP COLUMN tag_ids");
      expect(DROP_TAGS).toContain("RAISE EXCEPTION");
      expect(DROP_TAGS).toContain("no rows in pipeline_stages");
    });
  });

  describe("nothing in the pipeline code reaches for a tag", () => {
    it("the API never reads or writes tag_ids", () => {
      expect(API).not.toContain("tag_ids");
      expect(API).not.toContain("tagIds");
      expect(API).not.toContain("project_tags");
    });

    it("the board view moves a project by setting one field", () => {
      expect(BOARD_VIEW).toContain("setProjectPipelineStage");
      expect(BOARD_VIEW).not.toContain("project_tags");
      // The drag used to be an upsert plus a delete against project_tags, which
      // is the window in which a card was in two columns at once.
      expect(BOARD_VIEW).not.toContain(".from(");
    });

    it("a card's column is pipeline_stage_id and nothing else", () => {
      expect(BOARD_VIEW).toContain("p.pipeline_stage_id === stage.id");
      expect(BOARD_VIEW).not.toContain("projectTagMap");
    });

    it("the stage editor types a stage rather than picking a tag", () => {
      expect(STAGE_EDITOR).not.toContain("allTags");
      expect(STAGE_EDITOR).not.toContain("TagRow");
      expect(CREATE_DIALOG).not.toContain("allTags");
      expect(SETTINGS_SHEET).not.toContain("allTags");
      // Tag names are still passed in, but only so a pipeline named after one
      // can be questioned - never as a source of columns.
      expect(CREATE_DIALOG).toContain("tagNames");
      expect(SETTINGS_SHEET).toContain("tagNames");
    });

    it("adding a project to a column is a move, not a second membership", () => {
      expect(ADD_DIALOG).toContain("setProjectPipelineStage");
      expect(ADD_DIALOG).not.toContain("project_tags");
      expect(ADD_DIALOG).toContain("one stage at a time");
    });

    it("the projects page carries the field on the row", () => {
      expect(PROJECTS_PAGE).toContain("pipeline_stage_id?: string | null");
      expect(PROJECTS_PAGE).toContain("<PipelineBoardView");
      expect(PROJECTS_PAGE).not.toContain("TagBoardDetailView");
    });

    it("keeps tags themselves untouched as a filter dimension", () => {
      // The ask was to stop tags doubling as stages, not to remove tags.
      expect(PROJECTS_PAGE).toContain("projectTagMap");
      expect(PROJECTS_PAGE).toContain('key: "tags"');
    });
  });

  describe("stage lists that cannot be saved", () => {
    it("caps a pipeline at a workable number of columns", () => {
      expect(MAX_PIPELINE_STAGES).toBeGreaterThanOrEqual(DEFAULT_PIPELINE_STAGES.length);
      expect(API).toContain("MAX_PIPELINE_STAGES");
    });

    it("refuses two stages that read the same", () => {
      expect(API).toContain("Two stages are both called");
      expect(STAGE_EDITOR).toContain("Two stages are both called");
    });
  });

  /*
   * Single-select is what made these possible, so they are part of the same
   * change rather than polish on top of it. Under tags, "which jobs are not on
   * the board" had no answer, hiding a card by search could hide it from one
   * column while leaving it in another, and "move" was two writes that could
   * half-fail.
   */
  describe("the board once there is real work on it", () => {
    it("shows the jobs that are in no pipeline, and lets one be dragged out of it", () => {
      expect(BOARD_VIEW).toContain('const UNASSIGNED = "__unassigned__"');
      expect(BOARD_VIEW).toContain("not in a pipeline");
      // Dropping on the rail writes NULL, which is the same single field.
      expect(BOARD_VIEW).toContain("overId === UNASSIGNED ? null : overId");
      expect(BOARD_VIEW).toContain("Release to take it out of the pipeline");
    });

    it("keeps a tall column from swallowing the page", () => {
      // One stage holding forty jobs used to make the whole page that tall and
      // push every other column's header off-screen.
      expect(BOARD_VIEW).toContain("max-h-[min(70vh,640px)]");
      expect(BOARD_VIEW).toContain("overflow-y-auto");
    });

    it("can move a card without a drag", () => {
      // Keyboard-only, one-handed on a phone, or into an off-screen column.
      expect(BOARD_VIEW).toContain("Move to stage");
      expect(BOARD_VIEW).toContain("Take out of the pipeline");
      // Opening the menu must not read as the beginning of a drag.
      expect(BOARD_VIEW).toContain("onPointerDown={(e) => e.stopPropagation()}");
    });

    it("searches the board without touching the page's own search", () => {
      expect(BOARD_VIEW).toContain("Search this pipeline");
      expect(BOARD_VIEW).toContain("of ${placedTotal} shown");
    });

    it("says where a job is from the list and from the project itself", () => {
      // A field on the project should read wherever the project does, not only
      // on the one screen that draws it as a column.
      expect(PROJECTS_PAGE).toContain("stageLookup[p.pipeline_stage_id]");
      expect(PROJECTS_PAGE).toContain("Set pipeline stage");
      expect(STAGE_CHIP).toContain("setProjectPipelineStage");
      expect(DETAIL_PAGE).toContain("<ProjectStageChip");
    });

    it("filters the project list by stage, and by having no stage at all", () => {
      expect(PROJECTS_PAGE).toContain('{ key: "stage", label: "Stage"');
      expect(PROJECTS_PAGE).toContain("Not in a pipeline");
      expect(PROJECTS_PAGE).toContain('const NO_STAGE = "__none__"');
    });

    it("makes the stage filter OR where the tag filter is AND", () => {
      // A project holds one stage, so "Scheduled AND Invoiced" is always empty.
      // Ticking two stages has to mean either, or the control is a trap.
      expect(PROJECTS_PAGE).toContain("selectedStageIds.includes(p.pipeline_stage_id ?? NO_STAGE)");
      expect(PROJECTS_PAGE).toContain("selectedTagIds.every((id) => tagIds.has(id))");
    });

    it("offers a way off the tag-derived columns a migrated board inherits", () => {
      // Every board that predates the rework had its columns built from tag
      // names, so plenty read "carpet" or "2025". Retyping six rows is enough
      // friction that most people would leave them.
      expect(SETTINGS_SHEET).toContain("Use the standard stages");
      expect(SETTINGS_SHEET).toContain("defaultStageDrafts()");
      // Only when they are not already the standard set.
      expect(SETTINGS_SHEET).toContain("{!looksStandard && (");
    });

    it("hides the stage control entirely when the team has no pipeline", () => {
      // A dead dropdown is worse than no dropdown.
      expect(STAGE_CHIP).toContain("if (boards.length === 0) return null;");
      expect(PROJECTS_PAGE).toContain("stageOptions.length > 0 &&");
    });
  });

  /*
   * The client's second round, after using it:
   *
   *   "when i add pipelines it gets created on the right side but no arrow to
   *    move it, it hides there."
   *
   *   "when i pick a project for a pipeline it attaches it nicely but I also
   *    have to click done ... Done is extra click thats not needed."
   */
  describe("a new pipeline does not hide, and nothing pretends to need saving", () => {
    it("gives the tab strip arrows, and only on the side with more to see", () => {
      // The strip scrolled and hid its scrollbar, so a tab past the edge was
      // reachable by trackpad swipe and nothing else.
      expect(TAB_STRIP).toContain("Scroll pipelines left");
      expect(TAB_STRIP).toContain("Scroll pipelines right");
      expect(TAB_STRIP).toContain("{overflow.left && <ArrowButton");
      expect(TAB_STRIP).toContain("{overflow.right && <ArrowButton");
      // Measured, not assumed, and re-measured when the box or the list changes.
      expect(TAB_STRIP).toContain("ResizeObserver");
    });

    it("keeps the create button out of the part that scrolls", () => {
      // It used to scroll away with the tabs, so once the strip overflowed
      // there was no way to reach "Create pipeline" either.
      const scrollerEnd = TAB_STRIP.indexOf("pointer-events-none absolute inset-y-0 left-0");
      const plusAt = TAB_STRIP.indexOf('aria-label="Create pipeline"');
      expect(scrollerEnd).toBeGreaterThan(0);
      expect(plusAt).toBeGreaterThan(scrollerEnd);
      expect(TAB_STRIP).toContain("creating a pipeline is always an option");
    });

    it("scrolls the strip, never the page, to reveal the selected tab", () => {
      // scrollIntoView on a horizontal strip inside a scrolling page also
      // scrolls the page, which yanks the board out from under the reader.
      expect(TAB_STRIP).not.toContain("scrollIntoView(");
      expect(TAB_STRIP).toContain("el.scrollTo({");
    });

    it("selects the pipeline it just created", () => {
      expect(PROJECTS_PAGE).toContain("justCreatedBoardId.current = board.id;");
      expect(PROJECTS_PAGE).toContain("setActiveBoard(board);");
      // A refetch that races the insert comes back without the new board, and
      // the "keep the pointer valid" effect then bounces to another tab.
      expect(PROJECTS_PAGE).toContain("qc.setQueryData(");
      expect(PROJECTS_PAGE).not.toContain("invalidateQueries({ queryKey: qk.projectBoards");
      expect(PROJECTS_PAGE).toContain(
        "if (justCreatedBoardId.current === current.id) return current;",
      );
    });

    it("drops the Done button that read like a save step", () => {
      expect(ADD_DIALOG).not.toContain("DialogFooter");
      expect(ADD_DIALOG).not.toMatch(/>\s*Done\s*</);
      // The dialog still closes: DialogContent ships its own X, and Escape and
      // click-outside are Radix defaults.
      expect(ADD_DIALOG).toContain("onOpenChange={(v) => !v && onClose()}");
    });

    it("says the picks are already saved, and counts them", () => {
      expect(ADD_DIALOG).toContain("Each pick is saved as you make it");
      expect(ADD_DIALOG).toContain("setMovedCount((n) => n + 1)");
      expect(ADD_DIALOG).toContain('moved into "{stage.name}"');
      // Reset per opening, or the tally reads as the total of all time.
      expect(ADD_DIALOG).toContain("setMovedCount(0)");
    });
  });
});
