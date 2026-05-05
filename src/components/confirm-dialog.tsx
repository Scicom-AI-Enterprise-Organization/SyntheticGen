"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  // When true, render the confirm button in destructive style + show a warning icon.
  destructive?: boolean;
}

type Resolver = (value: boolean) => void;

interface ConfirmCtx {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const Context = createContext<ConfirmCtx | null>(null);

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<Resolver | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  function settle(value: boolean) {
    setOpen(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    // Defer the resolution so the dialog finishes its close transition before
    // the caller fires its next state update — keeps focus restoration clean.
    setTimeout(() => r?.(value), 0);
  }

  const destructive = opts?.destructive ?? false;
  const confirmText = opts?.confirmText ?? (destructive ? "Delete" : "Confirm");
  const cancelText = opts?.cancelText ?? "Cancel";

  return (
    <Context.Provider value={{ confirm }}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) settle(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {destructive && <AlertTriangle className="h-4 w-4 text-destructive" />}
              {opts?.title ?? "Are you sure?"}
            </DialogTitle>
            {opts?.body !== undefined && (
              <DialogDescription asChild>
                <div className="text-sm text-muted-foreground">{opts.body}</div>
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => settle(false)}>
              {cancelText}
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
              autoFocus
            >
              {confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}

/**
 * Imperative confirm — returns true if the user clicks the primary button,
 * false if they cancel or dismiss. Use to replace browser-native `confirm()`:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete X?", destructive: true }))) return;
 */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("useConfirm() must be called inside <ConfirmDialogProvider>");
  }
  return ctx.confirm;
}
