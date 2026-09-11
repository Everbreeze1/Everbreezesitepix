import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { GripVertical, Plus, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REFERENCE_BUTTON_PRIMARY,
  REFERENCE_BUTTON_SECONDARY,
  REFERENCE_CARD,
  REFERENCE_CARD_PADDING,
  REFERENCE_CHIP,
  REFERENCE_EYEBROW,
} from "@/components/ui/reference";

interface ChecklistItem {
  id: string;
  name: string;
  itemCount: number;
}

interface WorkflowPhase {
  id: string;
  name: string;
  type: "marker" | "actionable";
  stepCount?: number;
}

interface BlueprintEditorProps {
  blueprintId?: string;
  onBack?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
}

export function BlueprintEditor({
  blueprintId,
  onBack,
  onSave,
  onCancel,
}: BlueprintEditorProps) {
  const [name] = useState("HVAC Service Call");
  const [checklists] = useState<ChecklistItem[]>([
    { id: "1", name: "Pre-service safety checklist", itemCount: 6 },
    { id: "2", name: "Completion checklist", itemCount: 5 },
  ]);
  const [phases] = useState<WorkflowPhase[]>([
    { id: "1", name: "Initial contact", type: "marker" },
    { id: "2", name: "Diagnosis", type: "marker" },
    { id: "3", name: "Pictures of units", type: "actionable", stepCount: 2 },
    { id: "4", name: "Repair & service", type: "marker" },
    { id: "5", name: "Report back", type: "actionable", stepCount: 2 },
  ]);
  const [documents] = useState(["Site Plan template"]);
  const [reportTemplates] = useState([
    "HVAC Service Call Report",
    "Progress & Draw Request Report",
  ]);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-10 pb-10 pt-7">
      <div className="mb-3.5 text-[12.5px] text-faint">
        <Link to="/templates" onClick={onBack} className="text-primary hover:underline">
          Blueprints
        </Link>
        &nbsp;/&nbsp; {name}
      </div>
      <div className="flex items-center justify-between">
        <div className="text-[22px] font-bold tracking-[-0.01em] text-foreground">{name}</div>
        <div className="flex gap-2.5">
          <button onClick={onCancel} className={REFERENCE_BUTTON_SECONDARY}>Cancel</button>
          <button onClick={onSave} className={REFERENCE_BUTTON_PRIMARY}>Save blueprint</button>
        </div>
      </div>
      <div className="mb-6 text-[12.5px] text-faint">
        Used on 14 projects &middot; changes apply the next time this blueprint is assigned to a new project.
      </div>
      <div className={REFERENCE_EYEBROW}>Checklists</div>
      <div className={cn(REFERENCE_CARD, REFERENCE_CARD_PADDING, "mb-3.5")}>
        {checklists.map((cl) => (
          <div key={cl.id} className="flex items-center gap-3 border-b border-border py-[9px] last:border-b-0">
            <ListChecks className="h-4 w-4 shrink-0 text-primary" />
            <div className="flex-grow text-[13px] font-medium text-foreground">{cl.name}</div>
            <span className="text-[11.5px] text-faint">{cl.itemCount} items</span>
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-primary cursor-pointer">
          <Plus className="h-3.5 w-3.5" />Add from checklist library
        </div>
      </div>
      <div className={REFERENCE_EYEBROW}>Workflow phases</div>
      <div className={cn(REFERENCE_CARD, REFERENCE_CARD_PADDING, "mb-3.5")}>
        {phases.map((phase) => (
          <div key={phase.id} className="flex items-center gap-3 border-b border-border py-[9px] last:border-b-0">
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-faint" />
            <div className="flex-grow text-[13px] font-medium text-foreground">{phase.name}</div>
            <span className={REFERENCE_CHIP}>
              {phase.type === "marker" ? "Marker" : `Actionable · ${phase.stepCount} steps`}
            </span>
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-primary cursor-pointer">
          <Plus className="h-3.5 w-3.5" />Add phase
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className={REFERENCE_EYEBROW}>Documents</div>
          <div className={cn(REFERENCE_CARD, REFERENCE_CARD_PADDING)}>
            {documents.map((doc) => (
              <div key={doc} className="flex items-center gap-3 border-b border-border py-[9px] last:border-b-0">
                <span className="text-[13px] text-foreground">{doc}</span>
              </div>
            ))}
            <div className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-primary cursor-pointer">
              <Plus className="h-3.5 w-3.5" />Add document
            </div>
          </div>
        </div>
        <div>
          <div className={REFERENCE_EYEBROW}>Report templates</div>
          <div className={cn(REFERENCE_CARD, REFERENCE_CARD_PADDING)}>
            {reportTemplates.map((rt) => (
              <div key={rt} className="flex items-center gap-3 border-b border-border py-[9px] last:border-b-0">
                <span className="text-[13px] text-foreground">{rt}</span>
              </div>
            ))}
            <div className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-primary cursor-pointer">
              <Plus className="h-3.5 w-3.5" />Add report template
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}