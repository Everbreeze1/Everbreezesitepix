import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Camera,
  CheckSquare,
  ClipboardCheck,
  FolderKanban,
  FolderOpen,
  Workflow,
  Video,
  FileText,
  Layers,
  Users,
  LayoutTemplate,
  Sparkles,
  Map as MapIcon,
  Settings,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

type Guide = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  tips?: string[];
};

type Category = {
  id: string;
  title: string;
  icon: LucideIcon;
  blurb: string;
  guides: Guide[];
};

/*
 * These articles are written against the app as it is, not as it once was.
 * Three failure modes had accumulated, and they are the ones to check for the
 * next time this file is edited:
 *
 *   1. A thing was renamed and the article kept the old word. "Report issue"
 *      became Feedback, Showcases became Portfolio, and the AI stopped having
 *      a product name at all.
 *   2. A thing was rebuilt and the article kept the old steps. Roles went from
 *      Owner/Admin/Member/Viewer to the matrix in
 *      packages/shared/src/team-permissions.ts - Owner, Admin, Manager,
 *      Standard, Restricted - plus a subcontractor tier that is not a team
 *      role at all and does not occupy a seat.
 *   3. A thing shipped and no article followed. Blueprints, Portfolio and
 *      Tasks were entirely undocumented, which is worse than a stale article:
 *      searching for them returned nothing, so the page implied they did not
 *      exist.
 *
 * Plan gates and role gates are stated in the article rather than left for
 * someone to discover at the moment they press the button.
 */
const CATEGORIES: Category[] = [
  {
    id: "projects",
    title: "Projects & pipelines",
    icon: FolderKanban,
    blurb: "Create jobs, group them, and move them through your stages.",
    guides: [
      {
        id: "create-project",
        title: "Create a project",
        summary: "Start a job from a blueprint, or from blank.",
        steps: [
          "Open Projects in the sidebar and click Create project.",
          "On the Team plan the first step is choosing a blueprint. Pick one, or Start blank. If your trade has a default blueprint it is already selected for you.",
          "Enter the address (this is what pins the job on the Map), then the project name, client and job number.",
          "Click Create & start taking photos. Everything the blueprint carries is created on the project straight away.",
        ],
        tips: [
          "Below the Team plan there is no blueprint step, so you go straight to the details form.",
        ],
      },
      {
        id: "project-tabs",
        title: "What each project tab holds",
        summary:
          "Photos, Documents, Reports, Checklists, Walkthroughs, Workflows, Tasks, Calendar.",
        steps: [
          "Photos: everything captured on the job. Select photos here to tag, share, or generate a document from them.",
          "Documents: paperwork produced from your document templates.",
          "Reports: client-ready PDFs and AI summaries.",
          "Checklists and Workflows: the work the crew runs on site.",
          "Tasks: who is doing what, by when.",
          "Calendar: the same photos laid out by the day they were taken.",
        ],
      },
      {
        id: "project-groups",
        title: "Group related projects",
        summary: "Bundle jobs that belong to one client or programme.",
        steps: [
          "Open Projects, switch to the Groups tab and click New Group.",
          "Name it (for example, Starbucks Locations) and add a description.",
          "Add the projects that belong to it, then open the group for a view across all of them at once.",
        ],
      },
      {
        id: "pipelines",
        title: "Track jobs on a pipeline",
        summary: "Drag a project from one stage to the next.",
        steps: [
          "Open Projects, switch to the Pipelines tab and click New Pipeline.",
          "Name the pipeline and set its stages, in the order work moves through them.",
          "Add projects to the board. Each project sits in one stage at a time, and dragging its card is what changes that stage.",
        ],
      },
    ],
  },
  {
    id: "photos",
    title: "Photo capture & tagging",
    icon: Camera,
    blurb: "Capture, annotate, tag and organise site photos.",
    guides: [
      {
        id: "capture",
        title: "Capture photos on site",
        summary: "Shoot into a project without leaving the app.",
        steps: [
          "Open a project and tap the round camera button at the bottom-right. From anywhere else in the app, the same button shoots into your most recent project.",
          "Choose a capture mode along the bottom: Picture, Before/After, Untagged, Scan, Video or Walkthrough. Measure is on the Pro and Team plans.",
          "Take the shot, then add a caption (there is a Voice button if you would rather dictate it) and any tags.",
          "Save. Photos are geotagged and timestamped automatically, and upload in the background.",
        ],
        tips: [
          "Scan mode boosts contrast for documents and can be exported as a single-page PDF.",
          "Video and Walkthrough hand off to the walkthrough recorder, which captures narration alongside the photos.",
        ],
      },
      {
        id: "annotate",
        title: "Annotate & mark up a photo",
        summary: "Draw arrows, circles, and text directly on any photo.",
        steps: [
          "Open the photo from the Gallery or a project, then click the pencil (Annotate).",
          "Pick a tool: Freehand, Line, Arrow, Circle, Rectangle, Text or Timestamp. Measure is on the Pro and Team plans.",
          "Crop, rotate and adjust sit in the same toolbar.",
          "Save. The mark-up is stored as a new photo captioned “Annotated: …”, so the original is left untouched.",
        ],
      },
      {
        id: "tags",
        title: "Tag photos & bulk-tag",
        summary: "Group photos by trade, area, or custom tag.",
        steps: [
          "Select one or more photos and click Tag in the action bar.",
          "Tick any existing tags, or type into Add new tag to create one on the spot.",
          "Filter the Gallery by tag from the Tags chip in the toolbar.",
        ],
        tips: [
          "Photo tags and project labels are two different catalogues. Labels, which file projects and templates by trade, region or priority, are managed under Templates, Labels tab.",
        ],
      },
    ],
  },
  {
    id: "tasks",
    title: "Tasks",
    icon: CheckSquare,
    blurb: "Assign work, set priorities and due dates, and track it to done.",
    guides: [
      {
        id: "create-task",
        title: "Create and assign a task",
        summary: "Assignee, priority, due date, and the photos it is about.",
        steps: [
          "Open a project and go to the Tasks tab.",
          "Type into “Add a task” and press Enter for a quick one, or click Add task for the full form.",
          "Set the assignee. One person holds a task; anyone else you want kept in the loop is copied in from the task's Activity.",
          "Set a priority (Low, Normal, High or Urgent) and a due date.",
          "Attach photos if the task is about something you have already shot, then save.",
        ],
        tips: [
          "If the person you assign has not confirmed their email address yet, you get a warning before it saves. They still receive the email about it.",
        ],
      },
      {
        id: "task-status",
        title: "Move a task through its statuses",
        summary: "Open, In progress, Done.",
        steps: [
          "Click the status circle on a task row to advance it.",
          "The counts above the list are filters: click one to show only those tasks.",
          "A task with photos attached is completed by its photos, so ticking off the last photo closes the task.",
        ],
      },
      {
        id: "task-bulk",
        title: "Change many tasks at once",
        summary: "Reassign or re-date a whole selection in one go.",
        steps: [
          "Tick the checkbox on several tasks. A bulk bar appears.",
          "Set the assignee, priority, due date or status for the entire selection.",
        ],
      },
      {
        id: "task-notifications",
        title: "Who gets told about a task",
        summary: "What triggers an email, and how to change it.",
        steps: [
          "Assigning a task emails the assignee. Comments and mentions in a task's Activity notify the people on it.",
          "Each person controls their own email under Account & settings, Notifications: tasks assigned to me, comments and mentions, tasks I am copied in on, and work I assigned is done.",
          "The in-app bell always shows everything, whether or not email is switched on.",
        ],
      },
    ],
  },
  {
    id: "checklists",
    title: "Checklists",
    icon: ClipboardCheck,
    blurb: "Flat task lists for QA, punch, and safety walks.",
    guides: [
      {
        id: "apply-checklist",
        title: "Add a checklist to a project",
        summary: "Use a saved template, or start from blank.",
        steps: [
          "Open a project and go to the Checklists tab.",
          "Click New checklist. Choose Blank checklist to type your own items, or pick one of your saved templates from the same menu.",
          "Work through the items on site. Each one records who completed it and when.",
        ],
      },
      {
        id: "create-checklist-template",
        title: "Create a reusable checklist template",
        summary: "Save a checklist so the whole team can apply it to any project.",
        steps: [
          "Open Templates in the sidebar, go to the Checklists tab, then click New template.",
          "Name the template and add its items.",
          "Give each item an answer type: Checkbox, Pass / Fail, Yes / No, Rating (1-5), Numeric, or Text / Notes.",
          "Mark the items the crew must answer as required, then save. The template is now offered on every project.",
        ],
        tips: [
          "Templates need the Pro or Team plan. Creating and editing them needs the Owner or Admin role.",
        ],
      },
    ],
  },
  {
    id: "workflows",
    title: "Workflows",
    icon: Workflow,
    blurb: "Multi-phase processes with photo prompts and sign-offs.",
    guides: [
      {
        id: "workflow-vs-checklist",
        title: "Workflows vs Checklists: what's the difference?",
        summary: "Both track work; workflows add phases and sign-off.",
        steps: [
          "A checklist is a single flat list of items, good for QA, punch lists and safety walks.",
          "A workflow is a multi-phase process, for example Site assessment, then Removal, then Installation, then Testing, then Sign-off.",
          "Each phase holds its own steps, and can require a signature before the job moves on.",
        ],
      },
      {
        id: "create-workflow",
        title: "Create a workflow template",
        summary: "Design a repeatable multi-phase job process.",
        steps: [
          "Open Templates in the sidebar, go to the Workflows tab and click New workflow.",
          "Name it, then add phases in the order the work actually happens.",
          "Inside a phase, add steps. A step is a Checklist item (the crew ticks it off), a Photo prompt (the crew must capture a photo), or a Note field (the crew types a short answer).",
          "Tick Requires sign-off on any phase that has to be signed before the next one starts, then save.",
        ],
      },
      {
        id: "track-workflow",
        title: "Run a workflow on a project",
        summary: "Move through the phases as work is completed.",
        steps: [
          "Open a project, go to the Workflows tab and click Add workflow.",
          "Pick one of your workflow templates. Workflows always start from a template, so if the menu is empty, build one under Templates first.",
          "Complete the steps in the current phase, capture the photos it asks for, and collect the sign-off.",
          "Finishing a phase unlocks the next one.",
        ],
      },
    ],
  },
  {
    id: "walkthroughs",
    title: "Walkthroughs",
    icon: Video,
    blurb: "Narrated video tours of a job site.",
    guides: [
      {
        id: "record-walkthrough",
        title: "Record a walkthrough",
        summary: "Capture a narrated tour of the site.",
        steps: [
          "Open a project, go to the Walkthroughs tab and click Record walkthrough.",
          "Allow camera and microphone access, then narrate as you walk. Take photos as you go.",
          "Stop when you are finished. The recording uploads and its AI Summary is written automatically.",
        ],
        tips: [
          "Recording is on the Pro and Team plans. One take can run up to 10 minutes on Starter, 15 on Pro and 20 on Team. A longer job is simply more than one walkthrough.",
        ],
      },
      {
        id: "walkthrough-ai-summary",
        title: "The AI Summary of a walkthrough",
        summary: "The video, narrated, plus every photo described.",
        steps: [
          "Open a finished walkthrough. The recording plays with an AI narration track written from what you said.",
          "The narration list beside the video is chaptered. Click a chapter to jump the video to that moment.",
          "Click Play AI narration and the narration is read aloud over the footage, with the original audio ducked underneath.",
          "Below that, every photo you took carries its own AI narration: what was being done in that shot, and what you said on camera near that moment.",
        ],
        tips: [
          "A recording nobody spoke over still gets a Summary. It is written from the photos and their captions instead, and says so rather than inventing narration.",
        ],
      },
      {
        id: "share-walkthrough",
        title: "Share a walkthrough with a client",
        summary: "Send a link, no login required.",
        steps: [
          "Open the walkthrough and click Share. That switches on a public link and copies it.",
          "Click PDF to download the same summary as a document instead.",
          "Anyone with the link can view it without an account. Switch the link off again whenever you like.",
        ],
      },
    ],
  },
  {
    id: "reports",
    title: "Reports & documents",
    icon: FileText,
    blurb: "Client-ready PDFs and paperwork built from your photos.",
    guides: [
      {
        id: "create-report",
        title: "Build a report",
        summary: "Turn project photos and notes into a branded PDF.",
        steps: [
          "Open a project, go to the Reports tab and click New report.",
          "Choose a starting point: blank, one of the built-in starters, or one of your team's saved report templates.",
          "Add photo sections, drag to reorder them, and set the cover page.",
          "Preview, then save. Share it by link or download the PDF.",
        ],
      },
      {
        id: "generate-document",
        title: "Generate a document from photos",
        summary: "The two things you hand to a client, both AI-drafted.",
        steps: [
          "Select photos in a project or in the Gallery, then click Generate.",
          "AI Summary writes a short shareable brief. It is saved under Walkthroughs and listed in Reports.",
          "Report writes a client-ready document with a title page, summary, photo sections and conclusion. It is saved under Reports.",
          'Your Daily Log is not in this menu, because you never have to ask for it: it writes itself when you finish adding photos. See "Your daily log, written for you".',
          "Under the Documents heading of the same menu you can generate from one of your document templates instead, which fills the project's details in for you.",
        ],
        tips: [
          "Generating from the document library needs the Pro or Team plan. If a draft fails, the item is still saved without the AI text and tells you so.",
        ],
      },
    ],
  },
  {
    id: "blueprints",
    title: "Project blueprints",
    icon: FolderOpen,
    blurb: "One bundle that sets a whole job up in a single click.",
    guides: [
      {
        id: "blueprint-what",
        title: "What a blueprint is",
        summary: "The whole job setup, bundled and reusable.",
        steps: [
          "A blueprint is a complete job setup in one bundle: the checklists the crew runs, the workflows it follows, the walkthrough shot lists it works to, the paperwork it produces, and the labels that file it.",
          "The pieces themselves live on the other Templates tabs. A blueprint only bundles references to them, so editing a checklist template updates every blueprint that uses it.",
          "Blueprints are the first tab of Templates, called Project blueprints.",
        ],
      },
      {
        id: "create-blueprint",
        title: "Create a blueprint",
        summary: "Start from a pre-built one, or build your own.",
        steps: [
          "Open Templates in the sidebar. You land on Project blueprints.",
          "Click “Start from a pre-built blueprint” to install a complete worked example, or New blueprint to build your own.",
          "With the blueprint selected, add sections from the picker: checklists, workflows, walkthroughs, documents, reports and label sets.",
          "Drag the sections into the order you want them created in.",
        ],
        tips: [
          "Set a Trade on the blueprint and tick “Default for that trade”, and a new project of that trade starts pre-selected on it. Only one blueprint per trade can be the default.",
        ],
      },
      {
        id: "apply-blueprint",
        title: "Apply a blueprint to projects",
        summary: "One click on a new job, or a dozen already running.",
        steps: [
          "Select the blueprint and click Apply to projects.",
          "Tick one project or a dozen. Nothing is created until you confirm.",
          "Everything lands in the matching project tab, pre-filled with that project's details. The result screen lists exactly what was created on each job.",
          "To start a fresh job from it instead, use More actions, then New project from this.",
        ],
        tips: [
          "Building blueprints is available on Pro and Team. Applying them to projects is a Team plan feature, enforced on the server as well as in the app.",
        ],
      },
    ],
  },
  {
    id: "templates",
    title: "Templates library",
    icon: LayoutTemplate,
    blurb: "The shared library every project draws from.",
    guides: [
      {
        id: "templates-hub",
        title: "Templates hub",
        summary: "Eight tabs, one place to manage every reusable piece.",
        steps: [
          "Open Templates in the sidebar. Project blueprints comes first, and bundles everything below it into one job setup.",
          "Checklists holds flat item lists. Workflows holds multi-phase processes with sign-offs.",
          "Walkthroughs holds shot lists: the sequence of shots a crew works through, so the same job is documented the same way every time.",
          "Documents holds Word-style templates with placeholders that auto-fill from project data. Reports holds report layouts.",
          "Label sets bundles related labels so you can apply them together. Labels is the catalogue of the individual labels themselves.",
          "Create, edit, duplicate, archive or delete from any tab. Anything you save from inside a project lands here too.",
        ],
      },
      {
        id: "templates-access",
        title: "Who can use and edit templates",
        summary: "The plan gate and the role gate are different.",
        steps: [
          "Templates need the Pro or Team plan. Below that, the section shows an upgrade card instead.",
          "Everyone on the plan can apply templates to their own projects.",
          "Only the account owner and Admins can create or edit them. Managers and Standard members see the library read-only.",
        ],
      },
    ],
  },
  {
    id: "teams",
    title: "Team, roles & permissions",
    icon: Users,
    blurb: "Invite your crew, set what they can reach, and bring in subcontractors.",
    guides: [
      {
        id: "invite",
        title: "Invite a teammate",
        summary: "Add a crew member to your workspace.",
        steps: [
          "Open Teams in the sidebar and click Invite teammate.",
          "Enter their email and send. There is no role to choose here: everyone joins at the base level.",
          "Once they appear on the roster, open the menu on their row to change their role.",
        ],
        tips: [
          "Below the Team plan the invite dialog shows how many seats you have left. Subcontractors never use a seat.",
        ],
      },
      {
        id: "roles",
        title: "Roles & permissions",
        summary: "Owner, Admin, Manager, Standard, Restricted.",
        steps: [
          "Owner: whoever created the account. Full control including billing, and the only role that cannot be removed or re-roled, so a workspace can never end up with nobody who can pay the bill.",
          "Admin: the same access as the Owner. Billing, the team, every project, and the template library.",
          "Manager: runs their own crew and sees every project. They can re-role Standard and Restricted members, but never another Manager or an Admin. No billing, and no editing of the shared template library. Team plan only.",
          "Standard: works on every project, but cannot manage the team or billing. On Starter and Pro this seat is simply called Member, because on a flat plan there is no tier above or below it to be standard compared to.",
          "Restricted: sees only the jobs you assign them, and nothing else in the workspace. Team plan only.",
        ],
        tips: [
          "Starter is one Admin plus one Member. Pro is deliberately flat: Admins and Members, one level apart. The middle tier (Manager) and per-person job scoping (Restricted) are what the Team plan adds.",
          "Deleting projects, and editing templates and blueprints, need Owner or Admin. Every gate is enforced on the server as well as hidden in the app.",
        ],
      },
      {
        id: "job-scoping",
        title: "Scope somebody to named jobs",
        summary: "The Restricted role, and how to pick their jobs.",
        steps: [
          "On the Teams page, open the menu on that person's row and set their role to Restricted.",
          "Open the menu again and choose “Choose their jobs”.",
          "Tick the jobs they may open. Those are the only ones they can see. With nothing ticked they keep their seat and see no jobs at all.",
        ],
        tips: [
          "Putting a teammate on a job (the crew list on a project) is a different thing, and every plan has it. Scoping a person so that those jobs are all they can reach is the Restricted role, and that is what the Team plan sells.",
        ],
      },
      {
        id: "subcontractors",
        title: "Give a subcontractor access",
        summary: "An outside crew, on named jobs, without a seat.",
        steps: [
          "Open Teams in the sidebar and scroll to the Subcontractors panel.",
          "Click Invite subcontractor and enter their email, plus their company name if you want it shown next to their uploads.",
          "Tick the jobs they can reach, then send. They get their own login.",
          "On those jobs they can view and add photos, and nothing else. They cannot see billing, your team, or any other project.",
        ],
        tips: [
          "Subcontractor access is a Team plan feature, and a subcontractor does not occupy a paid seat.",
          "Only the account owner and Admins can invite or manage subcontractors.",
        ],
      },
    ],
  },
  {
    id: "portfolio",
    title: "Portfolio",
    icon: Layers,
    blurb: "A shareable mini-site of your best work.",
    guides: [
      {
        id: "portfolio-what",
        title: "What the Portfolio is",
        summary: "A public mini-site built from jobs you have already shot.",
        steps: [
          "Portfolio is a public mini-site made from work already in your account: one page per project, plus embeds for a website you already own.",
          "Open Portfolio in the sidebar. It has three tabs: Site (the mini-site itself), Projects (the pages that fill it), and Embeds (putting it on your own website).",
          "The band above the tabs is the publish switch. It tells you whether the site is live, and gives you its address.",
        ],
        tips: [
          "Portfolio is a Team plan feature. On other plans the row stays in the sidebar with a padlock, so you can still see what it does.",
        ],
      },
      {
        id: "portfolio-site",
        title: "Set up your portfolio site",
        summary: "A guided build, with a live preview beside it.",
        steps: [
          "Open Portfolio, then the Site tab. The first time through you get a guided build; you can switch to the full editor whenever you like.",
          "Work through the steps: Business (name, logo, brand colour), What you do, Cover, Where you work, About, Reviews, Contact, and Web address.",
          "The preview beside the form is exactly what visitors will see.",
          "Publish from the band at the top when you are happy with it.",
        ],
      },
      {
        id: "portfolio-projects",
        title: "Add a project page",
        summary: "Each item on the site is one project page.",
        steps: [
          "Open Portfolio, then the Projects tab, and click New project. Give it a title, for example “Kitchen & Bath Remodels”.",
          "In the builder, choose a cover photo, add a tagline and a description, then add sections and pull photos in from your real jobs.",
          "Back on the Projects tab, use the toggle to decide whether it shows on the site, and the star to badge it as featured.",
          "Drag the cards to set the order visitors see them in.",
        ],
      },
      {
        id: "portfolio-embeds",
        title: "Put your work on your own website",
        summary: "A gallery and a map you can paste anywhere.",
        steps: [
          "Open Portfolio, then the Embeds tab. There are two snippets: a website gallery and a website map.",
          "Copy a snippet and paste it into an Embed, Custom HTML or Code block on your own site.",
          "Embeds read from the same published work as your portfolio site, so they stay empty until something is published.",
        ],
        tips: [
          "If a snippet ends up somewhere it should not be, rotate the embed key. Any embed already installed elsewhere stops working until you paste the new snippet; your portfolio address is unaffected.",
        ],
      },
    ],
  },
  {
    id: "ai",
    title: "AI assistance",
    icon: Sparkles,
    blurb: "AI drafts the writing, so you only have to check it.",
    guides: [
      {
        id: "ai-usage",
        title: "What the AI does",
        summary: "No separate chatbot to learn.",
        steps: [
          "AI runs inside the features you already use, rather than in a chat window of its own.",
          "It analyses photos, writes your daily log for you when you finish adding photos, drafts report and document text, narrates a recorded walkthrough into an AI Summary, and pulls text out of a photo.",
          "Everything it writes is editable before you send it. If a draft fails, the item is still saved without the AI text and says so.",
        ],
      },
      {
        id: "ai-photo-analysis",
        title: "Analyse a photo",
        summary: "Let AI describe what is in the shot.",
        steps: [
          "Open a photo in the Gallery, and open the AI Analysis panel beside it.",
          "Click Run AI analysis. The result is saved with the photo.",
        ],
        tips: ["AI photo analysis needs an active paid subscription. Scans are unlimited."],
      },
      {
        id: "ai-daily-log",
        title: "Your daily log, written for you",
        summary: "It appears when you finish adding photos.",
        steps: [
          "Add photos to a project, from the camera or from your device.",
          "When the upload finishes, AI writes what was done into today's Daily Log and the card appears under the photo grid.",
          "Come back later the same day and the next batch is added to the same log rather than starting a new one.",
          "Open it to read or edit the whole day. Anything you type there is kept: later sessions are appended, never written over.",
        ],
        tips: [
          "The Daily Log is internal only and is not shared with clients. It is deliberately not in the Reports tab, which holds the two things you do hand over: the AI Summary and the Report.",
        ],
      },
      {
        id: "ai-walkthrough-report",
        title: "Turn a walkthrough into a report",
        summary: "Narration and photos in, structured write-up out.",
        steps: [
          "Open a recorded walkthrough and generate its report. AI turns the narration and the photos into a structured document.",
          "Edit any section, then share the link or download the PDF.",
        ],
        tips: ["Auto Reports from walkthroughs are on the Pro and Team plans."],
      },
    ],
  },
  {
    id: "map",
    title: "Map & Gallery",
    icon: MapIcon,
    blurb: "See jobs on a map, browse every photo in one place.",
    guides: [
      {
        id: "map",
        title: "Use the project map",
        summary: "Every project with an address, pinned.",
        steps: [
          "Open Maps in the sidebar.",
          "Filter with the chips at the top: Active, On hold, Completed, or All.",
          "Click a pin to open that project.",
        ],
        tips: [
          "A job only appears once its address has been located, so fill the address in when you create the project.",
        ],
      },
      {
        id: "gallery",
        title: "Browse the Gallery",
        summary: "Cross-project photo grid with filters.",
        steps: [
          "Open Gallery in the sidebar to see every photo across every project.",
          "Filter by project, by tag, or by a date range using the chips in the toolbar. Clear all resets them.",
          "Switch between Grid and Calendar with the toggle on the right.",
          "Click Select in the toolbar, or the tick box that appears on a photo as you hover it, to start picking. A bulk bar appears.",
          "Select photos to download, tag, print, share, generate a report from, hide, move to another project, or send to Trash.",
        ],
      },
    ],
  },
  {
    id: "account",
    title: "Account & workspace",
    icon: Settings,
    blurb: "Profile, notifications, deleted items, and feedback.",
    guides: [
      {
        id: "profile",
        title: "Update your profile",
        summary: "Change your name, photo, phone, or job title.",
        steps: [
          "Click your name at the bottom of the sidebar to open Account & settings, then Profile.",
          "Edit the fields and click Save.",
        ],
      },
      {
        id: "notifications",
        title: "Manage notifications",
        summary: "Control what you are emailed about.",
        steps: [
          "Go to Account & settings, then Notifications.",
          "The master Email switch turns every notification email off at once.",
          "Under it, choose per event: tasks assigned to me, comments and mentions, tasks I am copied in on, and work I assigned is done.",
          "The in-app bell always shows everything. Invitations, password resets and other account email are always sent.",
        ],
        tips: ["Push notifications are not available yet."],
      },
      {
        id: "trash",
        title: "Restore something you deleted",
        summary: "Deleted projects and photos are recoverable for 60 days.",
        steps: [
          "Open Trash under Workspace tools at the bottom of the sidebar. The badge on it is how many items are waiting there.",
          "Each item shows how many days are left before it is removed for good.",
          "Restore what you need, or purge it yourself if you want it gone sooner.",
        ],
        tips: [
          "After 60 days items are removed automatically and cannot be recovered, so restore sooner rather than later.",
        ],
      },
      {
        id: "feedback",
        title: "Report a problem or suggest a feature",
        summary: "Both go straight to the team.",
        steps: [
          "Open Feedback under Workspace tools at the bottom of the sidebar.",
          "Choose Report a problem, or Suggest a feature.",
          "Describe it. Your device details are filled in for you, and you can attach screenshots to a problem report.",
          "We reply to the email address on your account if we need more detail.",
        ],
      },
    ],
  },
];

const ALL_GUIDE_IDS = CATEGORIES.flatMap((c) => c.guides.map((g) => g.id));
const TOTAL_GUIDES = ALL_GUIDE_IDS.length;

/** Everything a guide can be matched on, lowercased once per render pass. */
function guideHaystack(g: Guide): string {
  return [g.title, g.summary, ...g.steps, ...(g.tips ?? [])].join(" ").toLowerCase();
}

export function HelpPage() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string[]>([]);

  const q = query.trim().toLowerCase();

  /** Categories with non-matching guides removed; empty categories drop out. */
  const results = useMemo(() => {
    if (!q) return CATEGORIES;
    return CATEGORIES.map((cat) => {
      // A category-level match (its own title/blurb) keeps all of its guides,
      // so searching "workflows" shows the whole section rather than nothing.
      const catMatches = `${cat.title} ${cat.blurb}`.toLowerCase().includes(q);
      const guides = catMatches
        ? cat.guides
        : cat.guides.filter((g) => guideHaystack(g).includes(q));
      return { ...cat, guides };
    }).filter((cat) => cat.guides.length > 0);
  }, [q]);

  const matchCount = results.reduce((n, c) => n + c.guides.length, 0);

  // Searching auto-opens what matched - the answer should be on screen, not
  // one more click away.
  useEffect(() => {
    if (!q) return;
    setOpen(results.flatMap((c) => c.guides.map((g) => g.id)));
  }, [q, results]);

  // Deep links (/help#annotate) still work: open that guide and scroll to it.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id || !ALL_GUIDE_IDS.includes(id)) return;
    setOpen((prev) => (prev.includes(id) ? prev : [...prev, id]));
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "center" });
    });
  }, []);

  // Which category the reader is currently inside, so the rail can mark it.
  // The top margin matches the 82px sticky header plus a little breathing room,
  // so a section counts as "current" once it clears the header rather than the
  // moment it touches the top of the window.
  const [activeCat, setActiveCat] = useState("");
  useEffect(() => {
    const sections = results
      .map((c) => document.getElementById(c.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        // Topmost visible section wins, so scrolling up highlights the same
        // row that scrolling down did.
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActiveCat(top.target.id);
      },
      { rootMargin: "-98px 0px -70% 0px" },
    );
    sections.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [results]);

  const allOpen = open.length >= TOTAL_GUIDES;

  return (
    /*
      One centred column, like Settings. This page used to be a bare `p-10`
      with a `max-w-4xl` block inside it, which pinned every word to the left
      edge and left a third of a desktop window empty. Now the page centres in
      the shell, and on xl the width that is left over carries the category
      rail instead of nothing.
    */
    <div className="mx-auto w-full max-w-[1192px] px-6 pb-24 pt-10 md:px-10">
      <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.52px] text-muted-foreground">
        Support
      </p>
      <h1 className="font-display mt-3 text-[38.4px] font-bold leading-9 tracking-[-1.34px] text-foreground">
        Knowledge base
      </h1>
      <p className="font-manrope mt-3 max-w-[576px] text-sm leading-6 text-muted-foreground">
        Guides, tips, and answers for every SitePix workflow.
      </p>

      {/*
        One scannable list rather than three copies of the same navigation.
        This page previously showed 3 shortcut cards, then 10 category cards,
        then every one of the 20 guides fully expanded - so finding an answer
        meant scrolling past all of them. Topics are now collapsed by default
        and open in place.
      */}
      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_236px] xl:items-start">
        <div className="min-w-0 max-w-4xl xl:max-w-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search help - e.g. “blueprint”, “roles”, “tasks”…"
                className="h-11 rounded-xl pl-9 pr-9 text-sm font-medium"
                aria-label="Search help topics"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button
              variant="outline"
              className="h-11 shrink-0 rounded-xl text-xs font-bold"
              onClick={() => setOpen(allOpen ? [] : ALL_GUIDE_IDS)}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </Button>
          </div>

          <p className="font-manrope mt-3 text-xs font-semibold text-muted-foreground">
            {q
              ? `${matchCount} ${matchCount === 1 ? "topic" : "topics"} matching “${query.trim()}”`
              : `${TOTAL_GUIDES} topics across ${CATEGORIES.length} categories`}
          </p>

          {results.length === 0 ? (
            <div className="mt-8 rounded-2xl border-[0.8px] border-dashed border-border bg-card/60 p-10 text-center">
              <p className="font-manrope text-sm font-bold text-foreground">
                No topics match that.
              </p>
              <p className="font-manrope mt-1 text-sm text-muted-foreground">
                Try a different word, or clear the search to browse everything.
              </p>
              <Button
                variant="outline"
                className="mt-4 rounded-xl text-xs font-bold"
                onClick={() => setQuery("")}
              >
                Clear search
              </Button>
            </div>
          ) : (
            <Accordion
              type="multiple"
              value={open}
              onValueChange={setOpen}
              className="mt-6 space-y-8"
            >
              {results.map((cat) => (
                <section key={cat.id} id={cat.id} className="scroll-mt-24">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <cat.icon className="h-[18px] w-[18px] text-primary" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-manrope text-base font-bold tracking-[-0.3px] text-foreground">
                        {cat.title}
                      </h2>
                      <p className="font-manrope text-xs text-muted-foreground">{cat.blurb}</p>
                    </div>
                  </div>

                  <div className="mt-3 overflow-hidden rounded-2xl border-[0.8px] border-border bg-card/[0.82]">
                    {cat.guides.map((g) => (
                      <AccordionItem
                        key={g.id}
                        value={g.id}
                        id={g.id}
                        className="scroll-mt-24 border-b-[0.8px] border-border px-5 last:border-b-0"
                      >
                        <AccordionTrigger className="gap-4 py-4 hover:no-underline">
                          <span className="min-w-0 text-left">
                            <span className="font-manrope block text-sm font-bold text-foreground">
                              {g.title}
                            </span>
                            <span className="font-manrope mt-0.5 block text-xs text-muted-foreground">
                              {g.summary}
                            </span>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pb-5">
                          <ol className="font-manrope ml-4 list-decimal space-y-2 text-sm leading-relaxed text-muted-foreground">
                            {g.steps.map((s, i) => (
                              <li key={i} className="pl-1">
                                {s}
                              </li>
                            ))}
                          </ol>
                          {g.tips && g.tips.length > 0 && (
                            <div className="mt-4 space-y-2">
                              {g.tips.map((t, i) => (
                                <div
                                  key={i}
                                  className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm"
                                >
                                  <span className="font-manrope mt-0.5 shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">
                                    Tip
                                  </span>
                                  <span className="font-manrope text-muted-foreground">{t}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </div>
                </section>
              ))}
            </Accordion>
          )}

          {/*
        Points at Feedback, which is where support actually is.

        This used to send people to "Account -> Chat with support" and to a
        "Report issue button in the sidebar". Neither exists: the settings
        support panes are unreachable dead code, and the sidebar row was renamed
        to Feedback when it grew to cover suggestions as well as bugs. A footer
        naming two things that are not there is worse than no footer, because it
        is the last thing somebody reads before giving up.
      */}
          <div className="mt-8 rounded-2xl border-[0.8px] border-border bg-card/60 p-6 text-center">
            <h3 className="font-manrope text-base font-bold text-foreground">
              Can't find what you need?
            </h3>
            <p className="font-manrope mt-1 text-sm text-muted-foreground">
              Open Feedback in the sidebar to report a problem or suggest a feature. Both go
              straight to the team.
            </p>
            <Link
              to="/report-issue"
              className="font-manrope mt-3 inline-block text-sm font-bold text-primary hover:underline"
            >
              Go to Feedback →
            </Link>
          </div>
        </div>

        {/*
          The rail is what the empty right-hand third becomes: 14 categories,
          each one a jump link, with the guide count and the section you are
          currently reading marked. It only appears at xl, where there is room
          for it beside a comfortable line length - below that the page falls
          back to the single column it has always been.
        */}
        {results.length > 0 && (
          <nav aria-label="Help categories" className="hidden xl:sticky xl:top-[98px] xl:block">
            <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.52px] text-muted-foreground">
              Categories
            </p>
            <ul className="mt-3 space-y-0.5 border-l-[0.8px] border-border">
              {results.map((cat) => (
                <li key={cat.id}>
                  <a
                    href={`#${cat.id}`}
                    onClick={() => setActiveCat(cat.id)}
                    className={cn(
                      "font-manrope -ml-px flex items-center gap-2 border-l-2 py-1.5 pl-3 text-xs transition-colors",
                      activeCat === cat.id
                        ? "border-primary font-bold text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    <cat.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">{cat.title}</span>
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {cat.guides.length}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
