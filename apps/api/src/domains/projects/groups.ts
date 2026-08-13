import { getSupabaseAdmin } from "../../lib/supabase";
import type { AuthedContext } from "../../lib/user-context";


// ============================================================
// List all groups owned by the current user (with member counts + thumbs)
// ============================================================

// ============================================================
// Get a single group with its projects and aggregated recent photos
// ============================================================

// ============================================================
// Create a new group (optionally with initial projects)
// ============================================================

// ============================================================
// Rename / update group metadata
// ============================================================

// ============================================================
// Delete a group (members cascade via FK)
// ============================================================

// ============================================================
// Replace the full project membership set of a group
// ============================================================

// ============================================================
// Add a single project to a group
// ============================================================

export async function listProjectGroupsService(ctx: AuthedContext) {
    const { supabase, userId } = ctx;

    const { data: groups, error } = await (supabase as any)
      .from("project_groups")
      .select("id, name, description, created_at, updated_at")
      .eq("owner_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const list = (groups as Array<{ id: string; name: string; description: string | null; created_at: string; updated_at: string }>) ?? [];
    if (list.length === 0) return { groups: [] };

    const groupIds = list.map((g) => g.id);
    const { data: members } = await (supabase as any)
      .from("project_group_members")
      .select("group_id, project_id")
      .in("group_id", groupIds);
    const byGroup: Record<string, string[]> = {};
    ((members as Array<{ group_id: string; project_id: string }>) ?? []).forEach((m) => {
      (byGroup[m.group_id] ??= []).push(m.project_id);
    });

    // Fetch up to 4 recent-photo thumbnails per group
    const allProjectIds = Array.from(new Set(Object.values(byGroup).flat()));
    let photoUrlByProject: Record<string, string> = {};
    if (allProjectIds.length) {
      const { data: ph } = await (supabase as any)
        .from("photos")
        .select("project_id, storage_path, image_url, created_at")
        .in("project_id", allProjectIds)
        .order("created_at", { ascending: false });
      const seen = new Set<string>();
      const toSign: Array<{ pid: string; path: string }> = [];
      ((ph as Array<{ project_id: string; storage_path: string; image_url: string | null }>) ?? []).forEach((row) => {
        if (seen.has(row.project_id)) return;
        seen.add(row.project_id);
        if (row.image_url) photoUrlByProject[row.project_id] = row.image_url;
        else toSign.push({ pid: row.project_id, path: row.storage_path });
      });
      if (toSign.length) {
        const { data: signed } = await supabase.storage
          .from("site-photos")
          .createSignedUrls(toSign.map((s) => s.path), 60 * 60);
        signed?.forEach((s, i) => {
          if (s.signedUrl) photoUrlByProject[toSign[i].pid] = s.signedUrl;
        });
      }
    }

    return {
      groups: list.map((g) => {
        const pids = byGroup[g.id] ?? [];
        const thumbs = pids.map((pid) => photoUrlByProject[pid]).filter(Boolean).slice(0, 4);
        return {
          id: g.id,
          name: g.name,
          description: g.description,
          created_at: g.created_at,
          updated_at: g.updated_at,
          project_count: pids.length,
          thumbnails: thumbs,
        };
      }),
    };
  }

export async function getProjectGroupService(ctx: AuthedContext, data: any) {
    const { supabase, userId } = ctx;

    const { data: group, error: gErr } = await (supabase as any)
      .from("project_groups")
      .select("id, name, description, owner_id, created_at, updated_at")
      .eq("id", data.groupId)
      .maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (!group || group.owner_id !== userId) throw new Error("Group not found");

    const { data: mem } = await (supabase as any)
      .from("project_group_members")
      .select("project_id")
      .eq("group_id", data.groupId);
    const projectIds = ((mem as Array<{ project_id: string }>) ?? []).map((m) => m.project_id);

    let projects: any[] = [];
    let photoCounts: Record<string, number> = {};
    let reportCounts: Record<string, number> = {};
    let checklistCount = 0;
    let taskCount = 0;
    let recentPhotos: Array<{ id: string; project_id: string; project_name: string; url: string; created_at: string; caption: string | null }> = [];
    let coverByProject: Record<string, string> = {};

    if (projectIds.length) {
      const { data: projRows } = await (supabase as any)
        .from("projects")
        .select("*")
        .in("id", projectIds)
        .is("deleted_at", null);
      projects = (projRows as any[]) ?? [];

      const { data: ph } = await (supabase as any)
        .from("photos")
        .select("id, project_id, caption, storage_path, image_url, created_at")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false });
      // Includes walkthrough captures: a group card's photo count that
      // disagrees with the project's own photo count is a bug report waiting
      // to happen. See the note in ProjectDetailPage's `load`.
      const photos =
        (ph as Array<{ id: string; project_id: string; caption: string | null; storage_path: string; image_url: string | null; created_at: string }>) ?? [];

      photos.forEach((p) => {
        photoCounts[p.project_id] = (photoCounts[p.project_id] ?? 0) + 1;
      });

      // Sign covers + recent 12
      const covers: Record<string, { path: string; image_url: string | null }> = {};
      photos.forEach((p) => {
        if (!covers[p.project_id]) covers[p.project_id] = { path: p.storage_path, image_url: p.image_url };
      });
      const recent = photos.slice(0, 12);
      const toSign = Array.from(new Set([
        ...Object.values(covers).filter((c) => !c.image_url).map((c) => c.path),
        ...recent.filter((r) => !r.image_url).map((r) => r.storage_path),
      ]));
      let signedMap: Record<string, string> = {};
      if (toSign.length) {
        const { data: signed } = await supabase.storage
          .from("site-photos")
          .createSignedUrls(toSign, 60 * 60);
        signed?.forEach((s, i) => { if (s.signedUrl) signedMap[toSign[i]] = s.signedUrl; });
      }
      Object.entries(covers).forEach(([pid, c]) => {
        coverByProject[pid] = c.image_url ?? signedMap[c.path] ?? "";
      });
      const nameById = new Map(projects.map((p) => [p.id, p.name]));
      recentPhotos = recent.map((r) => ({
        id: r.id,
        project_id: r.project_id,
        project_name: nameById.get(r.project_id) ?? "Project",
        url: r.image_url ?? signedMap[r.storage_path] ?? "",
        created_at: r.created_at,
        caption: r.caption,
      }));

      const { data: rep } = await (supabase as any)
        .from("project_reports")
        .select("project_id")
        .in("project_id", projectIds);
      ((rep as Array<{ project_id: string }>) ?? []).forEach((r) => {
        reportCounts[r.project_id] = (reportCounts[r.project_id] ?? 0) + 1;
      });

      // Checklists (with items) per project
      const { data: cls } = await (supabase as any)
        .from("project_checklists")
        .select("id, project_id, name, created_at")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false });
      const checklists = ((cls as Array<{ id: string; project_id: string; name: string; created_at: string }>) ?? []);
      const clIds = checklists.map((c) => c.id);
      let itemsByChecklist: Record<string, { total: number; done: number }> = {};
      let fullItemsByChecklist: Record<string, Array<{ id: string; label: string; completed_at: string | null; position: number }>> = {};
      if (clIds.length) {
        const { data: its } = await (supabase as any)
          .from("project_checklist_items")
          .select("id, checklist_id, label, completed_at, position")
          .in("checklist_id", clIds)
          .order("position", { ascending: true });
        ((its as Array<{ id: string; checklist_id: string; label: string; completed_at: string | null; position: number }>) ?? []).forEach((i) => {
          const c = (itemsByChecklist[i.checklist_id] ??= { total: 0, done: 0 });
          c.total += 1;
          if (i.completed_at) c.done += 1;
          (fullItemsByChecklist[i.checklist_id] ??= []).push({ id: i.id, label: i.label, completed_at: i.completed_at, position: i.position });
        });
      }
      const checklistsByProject: Record<string, Array<{ id: string; name: string; total: number; done: number; items: Array<{ id: string; label: string; completed_at: string | null; position: number }> }>> = {};
      checklists.forEach((c) => {
        (checklistsByProject[c.project_id] ??= []).push({
          id: c.id,
          name: c.name,
          total: itemsByChecklist[c.id]?.total ?? 0,
          done: itemsByChecklist[c.id]?.done ?? 0,
          items: fullItemsByChecklist[c.id] ?? [],
        });
      });


      // Tasks per project
      const { data: tks } = await (supabase as any)
        .from("tasks")
        // `assigned_by` rides along so the group rollup can apply the same
        // "only the assignee closes it" rule as the project panel, rather than
        // offering a status button the database then refuses.
        .select("id, project_id, title, status, priority, due_date, assignee_email, assignee_user_id, assigned_by, updated_at")
        .in("project_id", projectIds)
        .order("status", { ascending: true })
        .order("updated_at", { ascending: false });
      const tasks = ((tks as Array<{ id: string; project_id: string; title: string; status: string; priority: string; due_date: string | null; assignee_email: string | null; assignee_user_id: string | null; assigned_by: string | null; updated_at: string }>) ?? []);
      const tasksByProject: Record<string, typeof tasks> = {};
      tasks.forEach((t) => {
        (tasksByProject[t.project_id] ??= []).push(t);
      });
      const openTasksTotal = tasks.filter((t) => t.status !== "done").length;

      checklistCount = checklists.length;
      taskCount = openTasksTotal;

      return {
        group,
        projects: projects.map((p) => {
          const pc = checklistsByProject[p.id] ?? [];
          const pt = tasksByProject[p.id] ?? [];
          const clTotalItems = pc.reduce((s, c) => s + c.total, 0);
          const clDoneItems = pc.reduce((s, c) => s + c.done, 0);
          return {
            ...p,
            cover_url: coverByProject[p.id] ?? null,
            photo_count: photoCounts[p.id] ?? 0,
            report_count: reportCounts[p.id] ?? 0,
            checklists: pc,
            checklists_count: pc.length,
            checklist_items_total: clTotalItems,
            checklist_items_done: clDoneItems,
            tasks: pt,
            tasks_open: pt.filter((t) => t.status !== "done").length,
            tasks_total: pt.length,
          };
        }),
        recent_photos: recentPhotos,
        totals: {
          projects: projects.length,
          photos: Object.values(photoCounts).reduce((s, n) => s + n, 0),
          reports: Object.values(reportCounts).reduce((s, n) => s + n, 0),
          checklists: checklistCount,
          tasks: taskCount,
        },
      };
    }

    return {
      group,
      projects: [],
      recent_photos: [],
      totals: { projects: 0, photos: 0, reports: 0, checklists: 0, tasks: 0 },
    };
  }

export async function createProjectGroupService(ctx: AuthedContext, data: any) {
    const { supabase, userId } = ctx;
    const { data: created, error } = await (supabase as any)
      .from("project_groups")
      .insert({ owner_id: userId, name: data.name, description: data.description ?? null })
      .select("id, name, description, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);

    if (data.projectIds?.length) {
      const rows = data.projectIds.map((pid: string) => ({ group_id: created.id, project_id: pid }));
      const { error: mErr } = await (supabase as any).from("project_group_members").insert(rows);
      if (mErr) throw new Error(mErr.message);
    }
    return created;
  }

export async function updateProjectGroupService(ctx: AuthedContext, data: any) {
    const { supabase, userId } = ctx;
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    const { data: updated, error } = await (supabase as any)
      .from("project_groups")
      .update(patch)
      .eq("id", data.id)
      .eq("owner_id", userId)
      .select("id, name, description, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  }

export async function deleteProjectGroupService(ctx: AuthedContext, data: any) {
    const { supabase, userId } = ctx;
    const { error } = await (supabase as any)
      .from("project_groups")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

export async function setGroupProjectsService(ctx: AuthedContext, data: any) {
    const { supabase, userId } = ctx;
    // Ownership check
    const { data: g } = await (supabase as any)
      .from("project_groups")
      .select("id, owner_id")
      .eq("id", data.groupId)
      .maybeSingle();
    if (!g || g.owner_id !== userId) throw new Error("Group not found");

    const { error: delErr } = await (supabase as any)
      .from("project_group_members")
      .delete()
      .eq("group_id", data.groupId);
    if (delErr) throw new Error(delErr.message);

    if (data.projectIds.length) {
      const rows = data.projectIds.map((pid: string) => ({ group_id: data.groupId, project_id: pid }));
      const { error: insErr } = await (supabase as any).from("project_group_members").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true };
  }

export async function addProjectToGroupService(ctx: AuthedContext, data: any) {
    const { supabase, userId } = ctx;
    const { data: g } = await (supabase as any)
      .from("project_groups").select("id, owner_id").eq("id", data.groupId).maybeSingle();
    if (!g || g.owner_id !== userId) throw new Error("Group not found");
    const { error } = await (supabase as any)
      .from("project_group_members")
      .upsert({ group_id: data.groupId, project_id: data.projectId }, { onConflict: "group_id,project_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  }
