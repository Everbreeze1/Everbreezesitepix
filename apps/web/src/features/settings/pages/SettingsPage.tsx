import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  User as UserIcon,
  Bell,
  Building2,
  CreditCard,
  Users,
  LifeBuoy,
  LogOut,
  Sparkles,
  Upload,
  Loader2,
  Sun,
  Palette,
  Image as ImageIcon,
  Mail,
  Lock,
  Globe,
  Briefcase,
  Cookie,
  MessageCircle,
  HelpCircle,
  Crown,
  Check,
  Star,
  Tag,
  Plus,
  Trash2,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { authErrorMessage } from "@/lib/auth-errors";
import { useAuth } from "@/hooks/use-auth";
import { clampPhotosPerPage, useProfile } from "@/hooks/use-profile";
import { PhotosPerPagePicker } from "@/features/projects/components/PhotosPerPagePicker";
import { useTheme } from "@/hooks/use-theme";
import {
  useSubscription,
  PRO_AUTO_REPORTS_PER_MONTH,
  type BillingTier,
} from "@/hooks/use-subscription";
import { supabase } from "@/integrations/everlumen/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getMyTeam, createBillingPortalSession } from "@/features/settings/api";
// Same matrix the billing RPC enforces with - see domains/billing/service.ts.
import { can } from "@everlumen/shared/team-permissions";
import { WorkspaceLabelsSection } from "@/features/settings/components/WorkspaceLabelsSection";
import { RoleBadge } from "@/features/teams/components/RoleBadge";
import {
  parseNotificationPrefs,
  prefEnabled,
  type NotificationPrefs,
  type NotificationPrefKey,
} from "@everlumen/shared";
import { listReviewLinks, setReviewLinks, type ReviewLink } from "@/lib/review-links.functions";
import { useStorageUsage, formatBytes } from "@/hooks/use-storage-usage";
import { SUPPORT_EMAIL, mailtoHref } from "@/lib/contact";
import { writeWithNewColumns, PROFILE_JOB_KEYS } from "@/lib/merge-field-columns";
import { BusinessProfileSection } from "@/features/settings/components/BusinessProfileSection";
import { cn } from "@/lib/utils";

type SectionId =
  | "profile"
  | "notifications"
  | "appearance"
  | "security"
  | "company"
  | "billing"
  | "team"
  | "reviews"
  | "labels";

const inputClass =
  "h-[48px] rounded-[14px] border-border bg-card/[0.92] font-manrope text-sm text-foreground shadow-[0_5px_12px_-12px_rgba(16,25,41,0.35)] placeholder:text-muted-foreground focus-visible:ring-ring/30";
const fieldLabelClass =
  "font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground";

const SECTIONS: {
  id: SectionId;
  label: string;
  icon: React.ElementType;
  group: "Account" | "Your Company";
  hint: string;
}[] = [
  {
    id: "profile",
    label: "Profile",
    icon: UserIcon,
    group: "Account",
    hint: "Name, photo and role",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    group: "Account",
    hint: "Project and team updates",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    group: "Account",
    hint: "Set your workspace theme",
  },
  { id: "security", label: "Security", icon: Lock, group: "Account", hint: "Email and password" },
  {
    id: "company",
    label: "Company",
    icon: Building2,
    group: "Your Company",
    hint: "Branding and storage",
  },
  {
    id: "billing",
    label: "Billing",
    icon: CreditCard,
    group: "Your Company",
    hint: "Plan and included usage",
  },
  {
    id: "team",
    label: "Members",
    icon: Users,
    group: "Your Company",
    hint: "Invite and manage access",
  },
  {
    // Moved here out of the Templates hub at the client's request: labels are a
    // workspace catalog, not a template. See WorkspaceLabelsSection.
    id: "labels",
    label: "Labels",
    icon: Tag,
    group: "Your Company",
    hint: "The label catalog projects and photos use",
  },
  {
    id: "reviews",
    label: "Review Links",
    icon: Star,
    group: "Your Company",
    hint: "Get customers to leave reviews",
  },
];

/**
 * Where notification preferences USED to live, read once and never written.
 *
 * They are stored on `profiles.notification_prefs` now (20260916000000), where
 * the email sender can actually see them - the localStorage copy described a
 * preference no server could read, which was fine until task assignments
 * started reaching inboxes. This key survives only so somebody who switched
 * something off before that shipped is not quietly resubscribed by the fix.
 *
 * The old `NotifPrefs` shape is gone with it. Four of its seven keys named
 * things nothing sends; the ones that survive are in
 * packages/shared/src/notification-prefs.ts, which the sender imports too.
 */
const NOTIF_KEY = (uid: string) => `everlumen:notif-prefs:${uid}`;
const EXTRAS_KEY = (uid: string) => `everlumen:profile-extras:${uid}`;
const COMPANY_EXTRAS_KEY = (uid: string) => `everlumen:company-extras:${uid}`;

interface ProfileExtras {
  firstName: string;
  lastName: string;
  phone: string;
  jobTitle: string;
}
const DEFAULT_EXTRAS: ProfileExtras = { firstName: "", lastName: "", phone: "", jobTitle: "" };

/*
 * `roleTitleFor` used to live here, with a vocabulary of its own:
 *
 *   owner  -> "Workspace admin"
 *   admin  -> "Project manager"
 *   member -> "Crew member"
 *   everything else -> "Workspace admin"
 *
 * Both halves of that were wrong once the roles matrix existed. It called an
 * Admin a "Project manager" while Manager became a real, separate, Team-only
 * role - so the two most senior roles in the product swapped names on this one
 * screen. And Manager, Standard and Restricted all fell through to the default,
 * which means a Restricted member opened their own settings and was told they
 * were a Workspace admin. That is worse than the missing badge on the roster:
 * missing information makes you go and look, wrong information does not.
 *
 * Replaced by `RoleBadge`, which reads the one matrix in
 * packages/shared/src/team-permissions.ts and names the role the way this
 * customer's tier names it.
 */

export function SettingsPage() {
  const { user, signOut } = useAuth();
  const { profile, reload } = useProfile();
  const { theme, setTheme } = useTheme();
  const {
    planName,
    tier,
    isPro,
    isTeam,
    canUseWatermark,
    autoReportsUsed,
    autoReportsLimit,
    autoReportsRemaining,
  } = useSubscription();

  const fetchTeam = getMyTeam;
  const { data: teamData } = useQuery({
    queryKey: ["my-team", user?.id],
    queryFn: () => fetchTeam(),
    enabled: !!user,
    staleTime: 60_000,
  });
  const myTeamRole = teamData?.myRole ?? (teamData?.team ? "member" : "owner");

  const [active, setActive] = useState<SectionId>("profile");
  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  const displayName = profile?.full_name || user?.email || "Account";
  const initial = (profile?.full_name || user?.email || "?")[0]?.toUpperCase();

  return (
    <div className="mx-auto max-w-[1192px] px-6 pb-24 pt-10 md:px-10">
      <PageHeader
        eyebrow="Workspace settings"
        title="Your account, in focus."
        description="Manage your profile, company workspace, access, and account preferences from one place."
        actions={
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/70 px-4 py-3 shadow-sm">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground font-manrope text-xs font-extrabold text-background">
                {initial}
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate font-manrope text-sm font-extrabold text-foreground">
                {displayName}
              </div>
              {/*
                Your own role, named and explained by the same badge the roster
                uses. Hovering says what it grants, which is the one place a
                person is most likely to ask.
              */}
              <div className="mt-0.5">
                <RoleBadge role={myTeamRole} tier={tier} size="xs" />
              </div>
            </div>
          </div>
        }
      />

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <SidebarNav active={active} onSelect={setActive} />
            <Button
              variant="outline"
              className="w-full justify-start rounded-xl border-border bg-card/70 font-manrope font-bold text-muted-foreground hover:bg-card"
              onClick={signOut}
            >
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </aside>

        {/* Horizontal tab pills (mobile/tablet) */}
        <div className="lg:hidden -mx-4 px-4 overflow-x-auto scrollbar-none">
          <div className="flex gap-2 pb-2 min-w-max">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3.5 py-2 font-manrope text-sm font-bold whitespace-nowrap transition-all",
                  active === s.id
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card/70 text-muted-foreground hover:bg-card",
                )}
              >
                <s.icon className="h-4 w-4" />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 rounded-[28px] border border-border bg-card/[0.82] shadow-[0_20px_50px_-36px_rgba(16,25,41,0.5)]">
          <div className="flex items-start gap-4 border-b border-border p-6 md:p-8">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <current.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className={fieldLabelClass}>{current.group}</p>
              <h2 className="mt-1 font-manrope text-xl font-extrabold tracking-[-0.5px] text-foreground">
                {current.label}
              </h2>
              <p className="mt-1 font-manrope text-sm text-muted-foreground">{current.hint}</p>
            </div>
          </div>

          <div className="space-y-6 p-6 md:p-8">
            {active === "profile" && <ProfileSection />}
            {active === "security" && <AccountSection />}
            {active === "notifications" && <NotificationsSection />}
            {active === "appearance" && <AppearanceSection theme={theme} setTheme={setTheme} />}
            {active === "company" && (
              <CompanySection
                profile={profile}
                reload={reload}
                canUseWatermark={canUseWatermark}
                isTeam={isTeam}
              />
            )}
            {active === "billing" && (
              <BillingSection
                planName={planName}
                tier={tier}
                isPro={isPro}
                isTeam={isTeam}
                autoReportsUsed={autoReportsUsed}
                autoReportsLimit={autoReportsLimit}
                autoReportsRemaining={autoReportsRemaining}
                teamData={teamData}
                isOwner={can(myTeamRole, "billing")}
              />
            )}
            {active === "team" && <TeamSection isTeam={isTeam} teamData={teamData} tier={tier} />}
            {active === "reviews" && <ReviewLinksSection isTeam={isTeam} />}
            {active === "labels" && (
              <WorkspaceLabelsSection
                teamId={teamData?.team?.id ?? null}
                canManage={!myTeamRole || can(myTeamRole, "manage_templates")}
              />
            )}

            {/* Mobile sign out */}
            <Button
              variant="outline"
              className="w-full rounded-xl border-border bg-card/70 font-manrope font-bold text-muted-foreground hover:bg-card lg:hidden"
              onClick={signOut}
            >
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Sidebar ---------------- */

function SidebarNav({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  const grouped = useMemo(() => {
    const groups: Record<string, typeof SECTIONS> = {};
    for (const s of SECTIONS) (groups[s.group] ||= []).push(s);
    return groups;
  }, []);
  return (
    <nav className="rounded-3xl border border-border bg-card/[0.82] p-3">
      {Object.entries(grouped).map(([group, items], gi) => (
        <div key={group} className={gi > 0 ? "mt-4 border-t border-border pt-4" : ""}>
          <div className="px-3 pb-2 font-manrope text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
            {group}
          </div>
          <div className="space-y-1">
            {items.map((s) => {
              const isActive = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all",
                    isActive ? "bg-primary/10 shadow-sm" : "hover:bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate font-manrope text-sm font-extrabold",
                        isActive ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {s.label}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block truncate font-manrope text-[10px] font-medium",
                        isActive ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {s.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/* ---------------- Section shell (kept for legacy/dead sections below) ---------------- */

function SectionShell({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-manrope text-xl font-extrabold text-foreground">{title}</h2>
          {description && (
            <p className="mt-1 font-manrope text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/* ---------------- Profile ---------------- */

function ProfileSection() {
  const { user } = useAuth();
  const { profile, reload } = useProfile();
  const [extras, setExtras] = useState<ProfileExtras>(DEFAULT_EXTRAS);
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(EXTRAS_KEY(user.id));
      if (raw) setExtras({ ...DEFAULT_EXTRAS, ...JSON.parse(raw) });
      else if (profile?.full_name) {
        const [first, ...rest] = profile.full_name.split(" ");
        setExtras((e) => ({ ...e, firstName: first ?? "", lastName: rest.join(" ") }));
      }
    } catch {}
  }, [user, profile?.full_name]);

  /*
   * The job title is the one entry in `extras` that is no longer local: it is
   * merged into documents as `{{job_title}}` (and as `{{prepared_by_title}}`,
   * the older spelling of the same field), so it has to live on the
   * profile. The stored copy wins over whatever localStorage still holds, and
   * `save` writes it back - which quietly migrates anyone whose title only ever
   * existed in this browser.
   */
  useEffect(() => {
    if (profile?.job_title) setExtras((e) => ({ ...e, jobTitle: profile.job_title ?? "" }));
  }, [profile?.job_title]);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
  }, [profile?.full_name]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const composedName = `${extras.firstName} ${extras.lastName}`.trim() || fullName || null;
    const { error } = await writeWithNewColumns(
      {
        id: user.id,
        email: user.email ?? null,
        full_name: composedName,
        job_title: extras.jobTitle.trim() || null,
      },
      PROFILE_JOB_KEYS,
      (row) => supabase.from("profiles").upsert(row as any, { onConflict: "id" }),
      "Saved without your job title",
    );
    if (!error) {
      localStorage.setItem(EXTRAS_KEY(user.id), JSON.stringify(extras));
      /*
       * Keep the auth copy of the name in step with the row we just wrote. It
       * is set once at signup (and once at invite accept) and was never updated
       * again, so an account that renamed itself here kept its original name on
       * the session forever - which is how a signup name resurfaces months
       * later in anything that only has the session to read. Best effort: the
       * profile row is the authority, so a failure here is not worth a toast.
       */
      if (composedName && composedName !== (user.user_metadata?.full_name as string | undefined)) {
        await supabase.auth.updateUser({ data: { full_name: composedName } });
      }
      toast.success("Profile updated");
      await reload();
    } else {
      toast.error(error.message);
    }
    setSaving(false);
  };

  const onAvatarUpload = async (files: FileList | null) => {
    if (!files?.[0] || !user) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return toast.error("Avatar must be an image");
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("company-logos")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) return toast.error(upErr.message);
      const { data: pub } = supabase.storage.from("company-logos").getPublicUrl(path);
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: pub.publicUrl })
        .eq("id", user.id);
      if (error) return toast.error(error.message);
      toast.success("Avatar updated");
      await reload();
    } finally {
      setUploading(false);
      if (avatarInput.current) avatarInput.current.value = "";
    }
  };

  const initials = (extras.firstName || fullName || user?.email || "?")[0]?.toUpperCase();

  return (
    <>
      <div className="flex flex-col items-start gap-5 rounded-2xl border border-border bg-card/70 p-5 sm:flex-row sm:items-center">
        <div className="relative shrink-0">
          <div className="flex h-20 w-20 items-center justify-center rounded-[21.6px] border-[1.6px] border-primary/20 bg-primary/10 font-manrope text-2xl font-extrabold text-primary">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-full w-full rounded-[21.6px] object-cover"
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-[21.6px] bg-black/40">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-manrope text-base font-extrabold text-foreground">Profile photo</div>
          <p className="mt-1 font-manrope text-sm text-muted-foreground">
            Use a square image so teammates recognize you in the field.
          </p>
        </div>
        <input
          ref={avatarInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onAvatarUpload(e.target.files)}
        />
        <Button
          size="sm"
          onClick={() => avatarInput.current?.click()}
          disabled={uploading}
          className="shrink-0 rounded-xl bg-primary font-manrope font-extrabold text-primary-foreground hover:bg-primary/90"
        >
          <ImageIcon className="mr-2 h-4 w-4" /> {profile?.avatar_url ? "Replace" : "Upload"}
        </Button>
      </div>

      <div className="grid gap-5 pt-2 sm:grid-cols-2">
        <Field label="Full name">
          <Input
            value={
              extras.firstName || extras.lastName
                ? `${extras.firstName} ${extras.lastName}`.trim()
                : fullName
            }
            onChange={(e) => {
              const [first, ...rest] = e.target.value.split(" ");
              setExtras({ ...extras, firstName: first ?? "", lastName: rest.join(" ") });
              setFullName(e.target.value);
            }}
            placeholder="Jordan Mitchell"
            className={inputClass}
          />
        </Field>
        <Field label="Work email">
          <Input value={user?.email ?? ""} disabled className={inputClass} />
        </Field>
        <Field label="Phone number">
          <Input
            value={extras.phone}
            onChange={(e) => setExtras({ ...extras, phone: e.target.value })}
            placeholder="+1 503 555 0142"
            className={inputClass}
          />
        </Field>
        <Field label="Job title">
          <Input
            value={extras.jobTitle}
            onChange={(e) => setExtras({ ...extras, jobTitle: e.target.value })}
            placeholder="Project manager"
            className={inputClass}
          />
        </Field>
      </div>

      <div className="flex justify-end border-t border-border pt-6">
        <Button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-primary font-manrope font-bold text-primary-foreground hover:bg-primary/90"
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          Save profile
        </Button>
      </div>
    </>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className={cn(fieldLabelClass, "flex items-center gap-1.5")}>
        {Icon && <Icon className="h-3.5 w-3.5" />} {label}
      </Label>
      {children}
    </div>
  );
}

/* ---------------- Account (Security tab) ---------------- */

function AccountSection() {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email ?? "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => setEmail(user?.email ?? ""), [user?.email]);

  const changeEmail = async () => {
    // Normalised for the same reason as signup/login: a stored address with
    // stray whitespace or mixed case becomes one the owner cannot type back.
    const next = email.trim().toLowerCase();
    if (!next || next === (user?.email ?? "").trim().toLowerCase()) return;
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: next });
    setSavingEmail(false);
    if (error) {
      console.error("[settings] email change failed", error);
      toast.error(authErrorMessage(error));
    } else toast.success("Check your inbox to confirm the new email.");
  };

  const changePassword = async () => {
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== pw2) return toast.error("Passwords don't match");
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSavingPw(false);
    if (error) {
      console.error("[settings] password change failed", error);
      toast.error(authErrorMessage(error));
    } else {
      toast.success("Password updated");
      setPw("");
      setPw2("");
    }
  };

  return (
    <>
      <div className="rounded-2xl border border-border bg-card/[0.55] p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Mail className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-manrope text-base font-extrabold text-foreground">
              Email address
            </div>
            <p className="font-manrope text-xs text-muted-foreground">
              We will confirm any change at the new address.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={cn(inputClass, "flex-1")}
          />
          <Button
            onClick={changeEmail}
            disabled={savingEmail || email === user?.email}
            className="rounded-lg bg-primary font-manrope font-bold text-primary-foreground hover:bg-primary/90 sm:w-[130px]"
          >
            {savingEmail && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update email
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card/[0.55] p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-manrope text-base font-extrabold text-foreground">Password</div>
            <p className="font-manrope text-xs text-muted-foreground">
              Use at least 8 characters and keep it unique.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className={fieldLabelClass}>New password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="At least 8 characters"
              className={inputClass}
            />
          </div>
          <div className="space-y-2">
            <Label className={fieldLabelClass}>Confirm password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="Repeat new password"
              className={inputClass}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button
            onClick={changePassword}
            disabled={savingPw || !pw}
            className="rounded-lg bg-primary font-manrope font-bold text-primary-foreground hover:bg-primary/90"
          >
            {savingPw && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update password
          </Button>
        </div>
      </div>
    </>
  );
}

/* ---------------- Notifications ---------------- */

function NotificationsSection() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPrefs>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /*
   * Read from the profile, not from this browser.
   *
   * These switches used to live in `localStorage` alone, which is one browser
   * on one device and which no server can read - so "Email notifications: off"
   * described a preference nothing consulted. Harmless while nothing was sent;
   * a real problem the moment task assignments started reaching people's
   * inboxes.
   *
   * The old local value is read once as a fallback, so somebody who turned
   * something off before this shipped keeps it off rather than being quietly
   * resubscribed by the fix. It is not written back to: the profile is the
   * record from here on.
   */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      let local: NotificationPrefs = {};
      try {
        const raw = localStorage.getItem(NOTIF_KEY(user.id));
        if (raw) local = parseNotificationPrefs(JSON.parse(raw));
      } catch {
        // A malformed local value is not worth telling anyone about. It reads
        // as "nothing expressed", which is every default.
      }
      const { data, error } = await supabase
        .from("profiles" as any)
        .select("notification_prefs")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Includes the window before 20260916000000 is applied by hand. Say so
        // rather than rendering defaults as though they were saved values - a
        // silently empty read is how a preferences screen lies.
        console.warn("[settings] could not read notification preferences", error.message);
        setPrefs(local);
        setLoading(false);
        return;
      }
      const stored = parseNotificationPrefs((data as any)?.notification_prefs);
      setPrefs(Object.keys(stored).length > 0 ? stored : local);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  /*
   * Written on every toggle rather than behind the Save button.
   *
   * The button used to call `toast.success("Preferences saved")` over a value
   * that had already been in localStorage since the switch was tapped, which is
   * a confirmation of nothing. A switch that reports its own outcome is the
   * honest shape, and the button below now says what it does.
   */
  const update = async (patch: NotificationPrefs) => {
    if (!user) return;
    const before = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setSaving(true);
    const { error } = await supabase
      .from("profiles" as any)
      .update({ notification_prefs: next })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      setPrefs(before);
      toast.error(
        /notification_prefs/.test(error.message)
          ? "Notification preferences need the latest SQL migration."
          : error.message,
      );
    }
  };

  /*
   * Exactly the messages this product actually sends by email today.
   *
   * The four rows that used to be here - comments on my photos, replies to my
   * comments, project activity, weekly digest - named things no sender exists
   * for. A row that governs nothing is the same lie as a switch nothing reads,
   * so they are gone rather than restyled. Add a row here when something starts
   * sending, not before.
   */
  const rows: { key: NotificationPrefKey; label: string; desc: string }[] = [
    {
      key: "taskAssigned",
      label: "Tasks assigned to me",
      desc: "When a teammate hands you a job. This is the one crews rely on.",
    },
    {
      key: "taskComments",
      label: "Comments and mentions",
      desc: "Notes written on a task you are on, and messages that name you.",
    },
    {
      key: "taskUpdates",
      label: "Tasks I am copied in on",
      desc: "When work you are following is reassigned or closed.",
    },
    {
      key: "taskCompleted",
      label: "Work I assigned is done",
      desc: "When somebody finishes a job you handed to them.",
    },
  ];

  const emailOn = prefEnabled(prefs, "emailEnabled");

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChannelCard
          icon={Mail}
          title="Email notifications"
          desc="Delivered to your account inbox."
          checked={emailOn}
          onChange={(v) => void update({ emailEnabled: v })}
        />
        {/*
          Not a preference, a statement of fact.
          Web push needs a service worker and VAPID keys that this deployment
          does not have, so nothing sends it. A live switch over a channel with
          no sender is exactly what this section was rebuilt to stop doing.
        */}
        <ChannelCard
          icon={Bell}
          title="Push notifications"
          desc="Not available yet. Assignments arrive by email and in the app."
          checked={false}
          disabled
          onChange={() => {}}
        />
      </div>

      <div className="divide-y divide-border rounded-2xl border border-border bg-card/70">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <div className="font-manrope text-sm font-bold text-foreground">{r.label}</div>
              <p className="mt-0.5 font-manrope text-xs text-muted-foreground">{r.desc}</p>
            </div>
            <Switch
              checked={emailOn && prefEnabled(prefs, r.key)}
              // Greyed out under the master switch rather than hidden: the rows
              // are still your settings, they just have nothing to govern while
              // email is off.
              disabled={loading || !emailOn}
              onCheckedChange={(v) => void update({ [r.key]: v } as NotificationPrefs)}
            />
          </div>
        ))}
      </div>

      <p className="font-manrope text-xs leading-5 text-muted-foreground">
        Turning email off does not affect the bell in the app - you will still see everything there.
        Invitations, password resets and other account email are always sent.
      </p>

      <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
        <span className="font-manrope text-xs text-muted-foreground">
          {saving ? "Saving…" : loading ? "Loading…" : "Saved automatically"}
        </span>
      </div>
    </>
  );
}

function ChannelCard({
  icon: Icon,
  title,
  desc,
  checked,
  onChange,
  disabled = false,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** A channel with no sender behind it. Shown, never operable. */
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-4 transition-all",
        checked ? "border-primary/40 bg-primary/5" : "border-border bg-card/70",
        disabled && "opacity-60",
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-lg",
          checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-manrope text-sm font-extrabold text-foreground">{title}</div>
        <p className="font-manrope text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/* ---------------- Appearance ---------------- */

function AppearanceSection({
  theme,
  setTheme,
}: {
  theme: string;
  setTheme: (t: "light" | "dark") => void;
}) {
  const [selected, setSelected] = useState<"light" | "dark">(
    (theme as "light" | "dark") ?? "light",
  );

  useEffect(() => {
    setSelected((theme as "light" | "dark") ?? "light");
  }, [theme]);

  const save = () => {
    setTheme(selected);
    toast.success("Appearance saved");
  };

  return (
    <div className="space-y-7">
      <p className="max-w-[576px] font-manrope text-sm leading-6 text-muted-foreground">
        Choose the work environment that feels best for long days reviewing site updates.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        {(["light", "dark"] as const).map((t) => {
          const active = selected === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setSelected(t)}
              className={cn(
                "rounded-2xl border-[0.8px] p-4 text-left transition-all",
                active
                  ? "border-primary bg-primary/5 shadow-[0_0_0_2px_rgba(37,132,244,0.2)]"
                  : "border-border bg-card/55 hover:bg-card/70",
              )}
            >
              <div
                className={cn(
                  "flex h-32 items-center justify-center rounded-xl",
                  // These two swatches are a literal preview of each theme option and must
                  // always render actual light/dark colors regardless of the app's current
                  // theme, so the "light" swatch intentionally keeps a fixed light hex.
                  t === "light" ? "bg-[#F5F4F0]" : "bg-sidebar",
                )}
              >
                {t === "light" ? (
                  <Sun className="h-9 w-9 text-[#F59E0B]" strokeWidth={1.75} />
                ) : (
                  <Palette className="h-9 w-9 text-sidebar-foreground" strokeWidth={1.75} />
                )}
              </div>
              <div className="flex items-center justify-between pt-4">
                <span className="font-manrope text-base font-extrabold capitalize text-foreground">
                  {t} mode
                </span>
                {active && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 font-manrope text-[10px] font-extrabold text-primary-foreground">
                    Active
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={save}
          className="rounded-lg bg-primary px-5 font-manrope font-bold text-primary-foreground hover:bg-primary/90"
        >
          <Check className="mr-2 h-4 w-4" /> Save appearance
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Company ---------------- */

function CompanySection({
  profile,
  reload,
  canUseWatermark,
  isTeam,
}: {
  profile: ReturnType<typeof useProfile>["profile"];
  reload: () => Promise<void>;
  canUseWatermark: boolean;
  isTeam: boolean;
}) {
  const { user } = useAuth();
  const [company, setCompany] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const { bytesUsed, bytesLimit, bytesPct } = useStorageUsage();

  useEffect(() => {
    if (!profile) return;
    setCompany(profile.company ?? "");
    setAddress(profile.company_address ?? "");
    setPhone(profile.company_phone ?? "");
  }, [profile]);

  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(COMPANY_EXTRAS_KEY(user.id));
      if (raw) setWebsite(JSON.parse(raw).website ?? "");
    } catch {
      /* ignore malformed local storage */
    }
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        email: user.email ?? null,
        company: company || null,
        company_address: address || null,
        company_phone: phone || null,
      },
      { onConflict: "id" },
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    localStorage.setItem(COMPANY_EXTRAS_KEY(user.id), JSON.stringify({ website }));
    toast.success("Company info saved");
    await reload();
  };

  const onLogoUpload = async (files: FileList | null) => {
    if (!files?.[0] || !user) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return toast.error("Logo must be an image");
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("company-logos")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) return toast.error(upErr.message);
      const { data: pub } = supabase.storage.from("company-logos").getPublicUrl(path);
      const { error } = await supabase
        .from("profiles")
        .update({ company_logo_url: pub.publicUrl })
        .eq("id", user.id);
      if (error) return toast.error(error.message);
      toast.success("Logo updated");
      await reload();
    } finally {
      setUploadingLogo(false);
      if (logoInput.current) logoInput.current.value = "";
    }
  };

  const companyInitial = (company || "?")[0]?.toUpperCase();

  return (
    <>
      {/* Who the business is, before the branding it puts on documents. */}
      <BusinessProfileSection />

      <div className="flex flex-col gap-5 rounded-2xl bg-accent p-5 sm:flex-row sm:items-center">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[21.6px] bg-card shadow-sm">
          {profile?.company_logo_url ? (
            <img
              src={profile.company_logo_url}
              alt="Company logo"
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="font-manrope text-2xl font-black text-primary">{companyInitial}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-manrope text-base font-extrabold text-foreground">Company logo</div>
          <p className="mt-1 font-manrope text-sm text-muted-foreground">
            Shown in reports, shared galleries, and optional photo watermarks.
          </p>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-manrope text-sm font-extrabold text-foreground">
                Watermark photos with logo
              </div>
              <p className="font-manrope text-xs text-muted-foreground">
                {canUseWatermark
                  ? "A subtle mark on every exported field photo."
                  : "Available on Team plan."}
              </p>
            </div>
            <Switch
              checked={canUseWatermark && profile?.watermark_enabled !== false}
              disabled={!canUseWatermark || !profile?.company_logo_url}
              onCheckedChange={async (checked) => {
                if (!user) return;
                const { error } = await supabase
                  .from("profiles")
                  .update({ watermark_enabled: checked })
                  .eq("id", user.id);
                if (error) return toast.error(error.message);
                toast.success(checked ? "Watermark on" : "Watermark off");
                await reload();
              }}
            />
          </div>
        </div>
        <input
          ref={logoInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onLogoUpload(e.target.files)}
        />
        <Button
          onClick={() => logoInput.current?.click()}
          disabled={uploadingLogo}
          className="shrink-0 rounded-xl border border-border bg-card font-manrope font-extrabold text-foreground shadow-sm hover:bg-card/90"
        >
          {uploadingLogo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {profile?.company_logo_url ? "Replace logo" : "Upload logo"}
        </Button>
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-card/55 p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Company name">
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Construction"
              className={inputClass}
            />
          </Field>
          <Field label="Business phone">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              className={inputClass}
            />
          </Field>
          <Field label="Business address">
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Builder St, City, State 00000"
              className={inputClass}
            />
          </Field>
          <Field label="Website">
            <Input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="acme.com"
              className={inputClass}
            />
          </Field>
        </div>

        {/*
          Report page density lives with the company details rather than in a
          settings screen of its own, because it is the same kind of fact: how
          this company's paperwork looks when a client receives it. It is also
          the only place the unattended Auto Report can be told - that one runs
          when a walkthrough ends, with no dialog to ask in.
        */}
        <div className="mt-5 border-t border-border pt-5">
          <div className="font-manrope text-sm font-extrabold text-foreground">Report layout</div>
          <p className="font-manrope text-xs text-muted-foreground">
            How densely photos sit in a report. The default for every new report, including the one
            built for you when a walkthrough ends. Any single report can still be changed
            afterwards.
          </p>
          <div className="mt-3">
            <PhotosPerPagePicker
              label="Photos per page"
              hint={false}
              value={clampPhotosPerPage(profile?.report_photos_per_page)}
              onChange={async (n) => {
                if (!user) return;
                const { error } = await supabase
                  .from("profiles")
                  .update({ report_photos_per_page: n })
                  .eq("id", user.id);
                if (error) return toast.error(error.message);
                toast.success(`New reports will use ${n} photo${n > 1 ? "s" : ""} per page`);
                await reload();
              }}
            />
          </div>
        </div>

        <div className="mt-5 border-t border-border pt-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="font-manrope text-sm font-extrabold text-foreground">
                Photo storage
              </div>
              <p className="font-manrope text-xs text-muted-foreground">
                {isTeam ? "Team plan" : "Starter plan"} · {formatBytes(bytesUsed)} of{" "}
                {formatBytes(bytesLimit)} used
              </p>
            </div>
            <div className="font-manrope text-sm font-extrabold text-primary">
              {formatBytes(bytesLimit)}
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(2, bytesPct)}%` }}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-primary font-manrope font-bold text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save company info
          </Button>
        </div>
      </div>
    </>
  );
}

/* ---------------- Billing ---------------- */

function BillingSection({
  planName,
  tier,
  isPro,
  isTeam,
  autoReportsUsed,
  autoReportsLimit,
  autoReportsRemaining,
  teamData,
  isOwner,
}: {
  planName: string;
  tier: string;
  isPro: boolean;
  isTeam: boolean;
  autoReportsUsed: number;
  autoReportsLimit: number;
  autoReportsRemaining: number;
  teamData: any;
  isOwner: boolean;
}) {
  const seatsUsed = (teamData?.members?.length ?? 1) + (teamData?.invites?.length ?? 0);
  const seatsLimit = teamData?.memberLimit ?? 2;
  const openPortal = useMutation({
    mutationFn: () =>
      createBillingPortalSession({
        data: { origin: typeof window !== "undefined" ? window.location.origin : "" },
      }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to open billing portal"),
  });

  const heroCopy = isTeam
    ? {
        title: "Built for the whole crew.",
        desc: "Shared workspaces, watermarks, collaboration, recorded walkthroughs, and unlimited Auto Reports.",
      }
    : isPro
      ? {
          title: "Everything a pro job site needs.",
          desc: `AI photo analysis, watermarks, unlimited projects, and ${PRO_AUTO_REPORTS_PER_MONTH} Auto Reports a month.`,
        }
      : {
          title: "Upgrade when you're ready.",
          desc: "Unlock Auto Reports, AI photo analysis, watermarks, and team collaboration.",
        };

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl bg-sidebar p-6">
        <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-sidebar-ring/20 blur-[64px]" />
        <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-[448px]">
            <span className="inline-flex items-center gap-2 rounded-full bg-sidebar-foreground/10 px-3 py-1 font-manrope text-xs font-extrabold text-sidebar-ring">
              <Crown className="h-3.5 w-3.5" /> {planName} plan
            </span>
            <h3 className="font-display mt-5 text-[36px] font-bold leading-9 tracking-[-1.26px] text-sidebar-foreground">
              {heroCopy.title}
            </h3>
            <p className="mt-3 font-manrope text-sm leading-6 text-sidebar-foreground/60">
              {heroCopy.desc}
            </p>
          </div>
          {isOwner ? (
            <Button
              disabled={openPortal.isPending}
              onClick={() => openPortal.mutate()}
              className="shrink-0 rounded-lg bg-sidebar-foreground font-manrope font-bold text-sidebar hover:bg-sidebar-foreground/90"
            >
              {openPortal.isPending ? "Opening…" : "Manage plan"}
            </Button>
          ) : (
            <span className="shrink-0 font-manrope text-xs text-sidebar-foreground/50">
              Only the team owner can manage billing.
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card/[0.55] p-5">
          {/* Team hides the ceiling - see WorkspaceCoverageCard in TeamsPage. */}
          <p className={fieldLabelClass}>{isTeam ? "People" : "Seats"}</p>
          <p className="mt-3 font-manrope text-lg font-extrabold text-foreground">
            {isTeam ? seatsUsed : `${seatsUsed} of ${seatsLimit}`}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card/[0.55] p-5">
          <p className={fieldLabelClass}>Auto Reports</p>
          <p className="mt-3 font-manrope text-lg font-extrabold text-foreground">
            {autoReportsLimit === Infinity
              ? "Unlimited"
              : autoReportsLimit === 0
                ? "Pro & Team only"
                : `${autoReportsUsed} / ${autoReportsLimit}`}
          </p>
          <p className="mt-1 font-manrope text-[11px] text-muted-foreground">
            {autoReportsLimit === Infinity
              ? "AI reports from your walkthroughs"
              : autoReportsLimit === 0
                ? "Upgrade to generate reports from walkthroughs"
                : `${autoReportsRemaining} remaining this month`}
          </p>
        </div>
      </div>
    </>
  );
}

/* ---------------- Team ---------------- */

const MEMBER_AVATAR_PALETTE = ["#059669", "#7C3AED", "#D97706", "#DB2777", "#0EA5E9", "#65A30D"];
const memberAvatarColor = (role: string, index: number) =>
  role === "owner" ? "#101929" : MEMBER_AVATAR_PALETTE[index % MEMBER_AVATAR_PALETTE.length];
/*
 * A second private role map lived here, identical in shape to the one the top
 * of this page carried and identical in consequence: a Manager, a Standard or a
 * Restricted teammate fell past its three keys to `?? m.role` and this list
 * printed the raw database value at them. Members is the one screen in Settings
 * where roles are the subject, so it was the worst place for it.
 *
 * Same replacement as everywhere else - RoleBadge, reading the one matrix.
 */

function TeamSection({
  isTeam,
  teamData,
  tier,
}: {
  isTeam: boolean;
  teamData: any;
  /** Only to name roles the way this tier names them - see RoleBadge. */
  tier: BillingTier;
}) {
  if (!isTeam) {
    return (
      <div className="rounded-2xl border border-border bg-card/70 p-8 text-center">
        <Users className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <p className="mt-3 font-manrope text-sm text-muted-foreground">
          Upgrade to invite teammates.
        </p>
        <Button
          asChild
          className="mt-4 rounded-lg bg-primary font-manrope font-bold text-primary-foreground hover:bg-primary/90"
        >
          <Link to="/pricing">See Team plan</Link>
        </Button>
      </div>
    );
  }

  const members = teamData?.members ?? [];
  const seatsUsed = members.length + (teamData?.invites?.length ?? 0);
  const seatsLimit = teamData?.memberLimit ?? 10;

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-manrope text-base font-extrabold text-foreground">Your team</div>
          <p className="mt-0.5 font-manrope text-sm text-muted-foreground">
            {/* TeamSection is Team-only (it early-returns otherwise), so the
                seat ceiling never belongs here. */}
            {seatsUsed} member{seatsUsed === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          asChild
          className="rounded-lg bg-primary font-manrope font-bold text-primary-foreground hover:bg-primary/90"
        >
          <Link to="/teams">
            <Users className="mr-2 h-4 w-4" /> Invite member
          </Link>
        </Button>
      </div>

      <div className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card/[0.55]">
        {members.map((m: any, idx: number) => (
          <div key={m.id ?? m.user_id} className="flex items-center justify-between gap-4 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-manrope text-xs font-extrabold text-white"
                style={{ background: memberAvatarColor(m.role, idx) }}
              >
                {(m.full_name || m.email || "?")[0]?.toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate font-manrope text-sm font-extrabold text-foreground">
                  {m.full_name || m.email}
                </div>
                <div className="mt-0.5">
                  <RoleBadge role={m.role} tier={tier} size="xs" />
                </div>
              </div>
            </div>
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="shrink-0 rounded-lg font-manrope text-xs font-extrabold text-muted-foreground hover:bg-accent"
            >
              <Link to="/teams">
                Manage <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Support (kept, no longer reachable from settings nav - Help Center now lives in the global sidebar) ---------------- */

function SupportTile({
  icon: Icon,
  title,
  desc,
  href,
  cta,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  href: string;
  cta: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel="noreferrer"
      className="group block"
      onClick={onClick}
    >
      <Card className="h-full p-5 transition-all hover:shadow-lg hover:-translate-y-0.5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">{title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
              {cta} <ArrowRight className="h-4 w-4" />
            </div>
          </div>
        </div>
      </Card>
    </a>
  );
}

const REVIEW_PLATFORM_LABELS: Record<ReviewLink["platform"], string> = {
  google: "Google Business Profile",
  nicejob: "NiceJob",
  custom: "Custom link",
};

function ReviewLinksSection({ isTeam }: { isTeam: boolean }) {
  const [links, setLinks] = useState<
    Array<{ platform: ReviewLink["platform"]; url: string; label: string }>
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isTeam) return;
    listReviewLinks().then((res) => {
      setLinks(res.links.map((l) => ({ platform: l.platform, url: l.url, label: l.label ?? "" })));
      setLoaded(true);
    });
  }, [isTeam]);

  if (!isTeam) {
    return (
      <div className="rounded-2xl border border-border bg-card/70 p-8 text-center">
        <Star className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <p className="mt-3 font-manrope text-sm text-muted-foreground">
          Upgrade to Team to let customers leave you reviews from a shared report.
        </p>
        <Button
          asChild
          className="mt-4 rounded-lg bg-primary font-manrope font-bold text-primary-foreground hover:bg-primary/90"
        >
          <Link to="/pricing">See Team plan</Link>
        </Button>
      </div>
    );
  }

  if (!loaded) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = links
        .filter((l) => l.url.trim())
        .map((l) => ({ platform: l.platform, url: l.url.trim(), label: l.label.trim() || null }));
      await setReviewLinks({ data: { links: cleaned } });
      toast.success("Review links saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save review links");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="font-manrope text-sm text-muted-foreground">
        Add links to your Google Business Profile, NiceJob, or any other review site. They'll show
        up as a "How did we do?" prompt on every shared report and Site Log.
      </p>
      {/* Two screens write this table now. Saying so here is what stops someone
          hand-pasting a Google link over the one the connection manages, which
          would work until the next re-sync quietly replaced it. */}
      <p className="font-manrope text-sm text-muted-foreground">
        Connecting your Google Business Profile from{" "}
        <Link to="/showcases" className="font-bold text-primary underline-offset-4 hover:underline">
          Portfolio
        </Link>{" "}
        fills the Google link in for you and puts your star rating on your mini-site.
      </p>

      {links.map((l, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-xl border border-border p-4 sm:flex-row sm:items-center"
        >
          <select
            value={l.platform}
            onChange={(e) =>
              setLinks((prev) =>
                prev.map((x, xi) =>
                  xi === i ? { ...x, platform: e.target.value as ReviewLink["platform"] } : x,
                ),
              )
            }
            className={cn(inputClass, "sm:w-56")}
          >
            {(Object.keys(REVIEW_PLATFORM_LABELS) as ReviewLink["platform"][]).map((p) => (
              <option key={p} value={p}>
                {REVIEW_PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
          {l.platform === "custom" && (
            <Input
              value={l.label}
              onChange={(e) =>
                setLinks((prev) =>
                  prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)),
                )
              }
              placeholder="Label (e.g. Yelp)"
              className={cn(inputClass, "sm:w-40")}
            />
          )}
          <Input
            value={l.url}
            onChange={(e) =>
              setLinks((prev) =>
                prev.map((x, xi) => (xi === i ? { ...x, url: e.target.value } : x)),
              )
            }
            placeholder="https://..."
            className={inputClass}
          />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => setLinks((prev) => prev.filter((_, xi) => xi !== i))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        className="rounded-lg border-border font-manrope font-bold"
        onClick={() => setLinks((prev) => [...prev, { platform: "google", url: "", label: "" }])}
      >
        <Plus className="mr-1.5 h-4 w-4" /> Add link
      </Button>

      <div className="pt-2">
        <Button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-primary font-manrope font-bold text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Save review links
        </Button>
      </div>
    </div>
  );
}

function HelpSection() {
  return (
    <SectionShell title="Help Center" description="Guides, tips, and answers to common questions.">
      <div className="grid gap-3 sm:grid-cols-2">
        <SupportTile
          icon={HelpCircle}
          title="Browse help articles"
          desc="Step-by-step guides for every part of Everlumen."
          href="https://www.everbreezesitepix.com/help"
          cta="Open Help Center"
        />
        <SupportTile
          icon={Sparkles}
          title="What's new"
          desc="Recent features, improvements, and fixes."
          href="https://www.everbreezesitepix.com/help"
          cta="See updates"
        />
        <SupportTile
          icon={Cookie}
          title="Manage cookies"
          desc="Adjust your cookie and analytics preferences."
          href="#"
          cta="Open preferences"
          onClick={(e) => {
            e.preventDefault();
            toast.info("Cookie preferences coming soon");
          }}
        />
      </div>
    </SectionShell>
  );
}

function ChatSection() {
  return (
    <SectionShell
      title="Chat with support"
      description="Talk to a real human. We usually reply in under an hour."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SupportTile
          icon={MessageCircle}
          title="Email support"
          desc="Send us a message and we'll get back to you fast."
          // The support mailbox is a placeholder until the owner confirms it
          // (see lib/contact.ts); until then these fall back to /contact rather
          // than opening a mail client addressed to a domain that isn't ours.
          href={mailtoHref(SUPPORT_EMAIL, "Everlumen support") ?? "/contact"}
          cta="Start a conversation"
        />
        <SupportTile
          icon={LifeBuoy}
          title="Report an issue"
          desc="Something broken? Tell us what happened."
          href={mailtoHref(SUPPORT_EMAIL, "Everlumen issue") ?? "/contact"}
          cta="Report issue"
        />
      </div>

      <Card className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-gradient-to-br from-primary/5 to-transparent">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">Have a feature request?</div>
          <p className="text-sm text-muted-foreground">
            We love hearing what you'd build next. Drop us a note.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href={mailtoHref(SUPPORT_EMAIL, "Everlumen feature idea") ?? "/contact"}>Send idea</a>
        </Button>
      </Card>
    </SectionShell>
  );
}
