import { createContext, useCallback, useContext, useRef, useState, ReactNode, FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type PromptOptions = {
  title?: string;
  description?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
};

type PromptFn = (options: PromptOptions | string) => Promise<string | null>;

const PromptContext = createContext<PromptFn | null>(null);

export function PromptDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<PromptOptions | null>(null);
  const [value, setValue] = useState("");
  const resolveRef = useRef<((value: string | null) => void) | undefined>(undefined);

  const prompt = useCallback<PromptFn>((opts) => {
    const resolved = typeof opts === "string" ? { title: opts } : opts;
    setOptions(resolved);
    setValue(resolved.defaultValue ?? "");
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const close = (result: string | null) => {
    resolveRef.current?.(result);
    resolveRef.current = undefined;
    setOptions(null);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) close(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    close(trimmed);
  };

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      <Dialog open={options !== null} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{options?.title ?? "Enter a value"}</DialogTitle>
              {options?.description && <DialogDescription>{options.description}</DialogDescription>}
            </DialogHeader>
            <div className="py-2">
              {options?.label && (
                <label className="mb-1.5 block text-xs font-bold text-muted-foreground">{options.label}</label>
              )}
              <Input
                autoFocus
                value={value}
                placeholder={options?.placeholder}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(null)}>
                {options?.cancelText ?? "Cancel"}
              </Button>
              <Button type="submit" disabled={!value.trim()}>
                {options?.confirmText ?? "OK"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PromptContext.Provider>
  );
}

export function usePrompt(): PromptFn {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error("usePrompt must be used within a PromptDialogProvider");
  return ctx;
}
