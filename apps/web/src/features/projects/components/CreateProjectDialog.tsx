import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { AddressAutocomplete, type ParsedAddress } from "@/components/AddressAutocomplete";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const fieldInputClass =
  "h-[48.2px] w-full rounded-[14.4px] border-[0.8px] border-border bg-card/[0.92] px-4 text-sm text-foreground shadow-[0px_5px_12px_-12px_rgba(16,25,41,0.35)] outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring";

export function CreateProjectDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [addrParts, setAddrParts] = useState<ParsedAddress | null>(null);
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (v: boolean) => {
    if (!v && !saving) {
      setName("");
      setAddress("");
      setAddrParts(null);
    }
    onOpenChange(v);
  };

  const create = async () => {
    if (!user) return;
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();
    if (!trimmedName && !trimmedAddress) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        created_by: user.id,
        name: trimmedName || trimmedAddress || "Untitled project",
        street: addrParts?.street || null,
        city: addrParts?.city || null,
        state: addrParts?.state || null,
        zip: addrParts?.zip || null,
        latitude: addrParts?.latitude ?? null,
        longitude: addrParts?.longitude ?? null,
        status: "active",
      } as any)
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(error?.message ?? "Could not create project");
      return;
    }
    toast.success("Project created");
    const projectId = (data as any).id as string;
    handleOpenChange(false);
    navigate({ to: "/projects/$projectId", params: { projectId } });
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 flex w-[448px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-start rounded-[28px] border-[0.8px] border-border bg-background p-6 shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)] duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="flex w-full items-center justify-between">
            <div>
              <p className="text-[10.88px] font-extrabold uppercase leading-4 tracking-[1.5232px] text-muted-foreground">
                SitePix workflow
              </p>
              <DialogPrimitive.Title className="pt-1 text-xl font-extrabold leading-7 text-foreground">
                Create a project
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <X className="h-4 w-4" strokeWidth={1.5} />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <div className="mt-5 flex w-full flex-col items-start gap-5">
            <div className="w-full">
              <label
                htmlFor="cp-name"
                className="mb-2 block text-sm font-bold leading-5 text-foreground"
              >
                Project name
              </label>
              <input
                id="cp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 325 Alder Street"
                autoFocus
                className={fieldInputClass}
              />
            </div>

            <div className="w-full">
              <label
                htmlFor="cp-address"
                className="mb-2 block text-sm font-bold leading-5 text-foreground"
              >
                Project address
              </label>
              <AddressAutocomplete
                id="cp-address"
                value={address}
                onChange={setAddress}
                onSelect={(addr) => {
                  setAddrParts(addr);
                  if (!name.trim() && addr.street) setName(addr.street);
                }}
                placeholder="Start typing an address"
                showIcon={false}
                inputClassName={fieldInputClass}
              />
            </div>
          </div>

          <div className="mt-7 flex w-full items-start justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="flex h-[41.6px] items-center justify-center rounded-lg border-[0.8px] border-border px-5 text-sm font-bold leading-5 text-foreground transition-colors hover:bg-accent"
              >
                Cancel
              </button>
            </DialogPrimitive.Close>
            <button
              type="button"
              onClick={create}
              disabled={saving || (!name.trim() && !address.trim())}
              className="flex h-[41.6px] items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold leading-5 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create project"}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
