import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REFERENCE_BUTTON_PRIMARY,
  REFERENCE_BUTTON_SECONDARY,
  REFERENCE_CARD,
  REFERENCE_CARD_PADDING,
  REFERENCE_CHIP,
} from "@/components/ui/reference";

interface DocumentWizardProps {
  onBack?: () => void;
  onSave?: () => void;
}

type CoverStyle = "minimal" | "centered" | "hero" | "photo";

function Step1(coverStyle: CoverStyle, setCoverStyle: (s: CoverStyle) => void) {
  const coverStyles: { key: CoverStyle; label: string; desc: string }[] = [
    { key: "minimal", label: "Minimal", desc: "Clean title on a plain page." },
    { key: "centered", label: "Centered", desc: "Large centered title with subtitle." },
    { key: "hero", label: "Hero band", desc: "Bold colored hero band on top." },
    { key: "photo", label: "Photo cover", desc: "Full-bleed cover photo with overlay." },
  ];
  return (
    <div className={cn(REFERENCE_CARD, REFERENCE_CARD_PADDING)}>
      <div className="mb-4">
        <div className="mb-1.5 text-xs font-semibold text-foreground">Template name</div>
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-foreground">Site Visit Report</div>
      </div>
      <div className="mb-5">
        <div className="mb-1.5 text-xs font-semibold text-foreground">Subtitle (optional)</div>
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-faint">Prepared for the client after each visit</div>
      </div>
      <div className="mb-2.5 text-xs font-semibold text-foreground">Cover page style</div>
      <div className="grid grid-cols-2 gap-2.5">
        {coverStyles.map((cs) => (
          <button key={cs.key} onClick={() => setCoverStyle(cs.key)}
            className={cn("rounded-[10px] border p-3 text-left", coverStyle === cs.key ? "border-primary bg-primary/10" : "border-border")}>
            <div className={cn("mb-2 h-11 rounded-md", cs.key === "minimal" && "bg-secondary", cs.key === "centered" && "bg-secondary", cs.key === "hero" && "bg-primary/20", cs.key === "photo" && "bg-gradient-to-br from-gray-500 to-gray-800")} />
            <div className="text-[12.5px] font-semibold text-foreground">{cs.label}</div>
            <div className="text-[11px] text-faint">{cs.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Step2() {
  return (
    <div className="flex flex-col gap-3">
      <div className="mb-0.5 text-xs text-faint">Drag to reorder. Click a token below to insert it into the body text.</div>
      {["Executive summary", "Observations", "Photos", "Next steps"].map((section) => (
        <div key={section} className={cn(REFERENCE_CARD, "px-4 py-3")}>
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] font-semibold text-foreground">{section}</span>
            <REFERENCE_CHIP>{section === "Executive summary" ? "Text only" : section === "Observations" ? "Text + photos" : section === "Photos" ? "Photo grid" : "Checklist recap"}</REFERENCE_CHIP>
          </div>
        </div>
      ))}
      <div className={cn(REFERENCE_CARD, "flex items-center justify-center border-dashed py-3.5 text-faint cursor-pointer")}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />Add section
      </div>
    </div>
  );
}

function Step3() {
  return (
    <div className={cn(REFERENCE_CARD, REFERENCE_CARD_PADDING)}>
      <div className="mb-4 text-[12.5px] text-muted-foreground">Placeholders are tokens like <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[10.5px] text-sky-700">{`{{project_name}}`}</span> that get replaced with real project data when the template is used.</div>
      <div className="mb-4 flex flex-wrap gap-2">
        {["project_name", "project_address", "author_name", "report_date", "photo_count"].map((tok) => (
          <span key={tok} className="flex items-center gap-1 rounded bg-sky-100 px-2 py-1 font-mono text-[10.5px] text-sky-700">{`{{${tok}}}`}<X className="h-3 w-3" /></span>
        ))}
      </div>
      <div className="flex gap-2.5">
        <div className="flex-grow rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-faint">e.g. client_name</div>
        <button className={REFERENCE_BUTTON_SECONDARY}><Plus className="h-3.5 w-3.5" /> Add</button>
      </div>
    </div>
  );
}

export function DocumentWizard({ onBack, onSave }: DocumentWizardProps) {
  const [step, setStep] = useState(1);
  const [coverStyle, setCoverStyle] = useState<CoverStyle>("hero");

  const steps = [
    { num: 1, label: "Basics" },
    { num: 2, label: "Sections" },
    { num: 3, label: "Placeholders" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-10 pb-10 pt-7">
      <div className="mb-4 text-[12.5px] text-faint">
        <Link to="/templates" onClick={onBack} className="text-primary hover:underline">Documents</Link>
        &nbsp;/&nbsp; New template
      </div>
      <div className="flex items-center gap-3.5 mb-7 max-w-[520px]">
        {steps.map((s, i) => (
          <div key={s.num} className="flex flex-1 items-center gap-2">
            <div className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
              step >= s.num ? "bg-primary text-primary-foreground" : "bg-secondary text-faint"
            )}>{s.num}</div>
            {i < steps.length - 1 && (
              <div className={cn("h-0.5 flex-grow", step > s.num ? "bg-primary" : "bg-border")} />
            )}
          </div>
        ))}
      </div>
      <div className="mb-2 flex gap-9 text-[11.5px] font-semibold text-faint">
        {steps.map((s) => (
          <span key={s.num} className={step === s.num ? "text-foreground" : ""}>{s.label}</span>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_420px] gap-7 mt-5.5">
        <div>
          {step === 1 && Step1(coverStyle, setCoverStyle)}
          {step === 2 && Step2()}
          {step === 3 && Step3()}
          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(Math.max(1, step - 1))} className={cn(REFERENCE_BUTTON_SECONDARY, step === 1 && "invisible")}>Back</button>
            <div className="flex-grow" />
            <button onClick={() => (step < 3 ? setStep(step + 1) : onSave?.())} className={REFERENCE_BUTTON_PRIMARY}>{step === 3 ? "Save changes" : "Next"}</button>
          </div>
        </div>
        <div>
          <div className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-faint">Live preview</div>
          <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-lg">
            {coverStyle === "minimal" && <div className="px-6.5 py-8.5"><div className="text-[17px] font-bold text-foreground">Site Visit Report</div><div className="mt-1 text-xs text-faint">Prepared for the client after each visit</div></div>}
            {coverStyle === "centered" && <div className="px-6.5 py-11 text-center"><div className="text-[19px] font-bold text-foreground">Site Visit Report</div><div className="mt-1.5 text-xs text-faint">Prepared for the client after each visit</div></div>}
            {coverStyle === "hero" && <div className="bg-primary px-6.5 py-7.5 text-primary-foreground"><div className="text-[18px] font-bold">Site Visit Report</div><div className="mt-1 text-xs opacity-85">Prepared for the client after each visit</div></div>}
            {coverStyle === "photo" && <div className="bg-gradient-to-br from-gray-500 to-gray-800 px-6.5 py-10 text-white"><div className="text-[18px] font-bold">Site Visit Report</div><div className="mt-1 text-xs opacity-80">Prepared for the client after each visit</div></div>}
            <div className="flex flex-col gap-4 px-6.5 py-5.5">
              <div><div className="mb-1 text-[10.5px] font-bold uppercase text-faint">Executive summary</div><div className="text-[12.5px] leading-relaxed text-muted-foreground">Overview of the site visit for <b>Meridian Build</b> on <b>Sept 8, 2026</b>.</div></div>
              <div><div className="mb-1 text-[10.5px] font-bold uppercase text-faint">Observations</div><div className="text-[12.5px] leading-relaxed text-muted-foreground">Framing complete on the east wing; electrical rough-in begins next week.</div></div>
              <div><div className="mb-1.5 text-[10.5px] font-bold uppercase text-faint">Photos</div><div className="grid grid-cols-3 gap-1.5"><div className="aspect-square rounded-md bg-secondary" /><div className="aspect-square rounded-md bg-secondary" /><div className="aspect-square rounded-md bg-secondary" /></div></div>
            </div>
          </div>
          <div className="mt-2.5 text-[11.5px] leading-relaxed text-faint">This updates as you edit — what your client sees is exactly what you're building here, not a guess.</div>
        </div>
      </div>
    </div>
  );
}