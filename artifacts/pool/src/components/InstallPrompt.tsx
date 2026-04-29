import { useState, type JSX } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, X } from "lucide-react";
import {
  dismissInstallPrompt,
  triggerNativeInstall,
  useInstallState,
  type InstallMode,
} from "@/lib/pwaInstall";

function ShareIosGlyph(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <rect x="5" y="10" width="14" height="11" rx="2" />
    </svg>
  );
}

function InstructionsDialog({
  mode,
  open,
  onOpenChange,
}: {
  mode: "ios-safari" | "macos-safari";
  open: boolean;
  onOpenChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm"
        data-testid="dialog-install-instructions"
      >
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wider text-base">
            <span className="text-primary">SYS::INSTALL</span> · Pool Hall
          </DialogTitle>
          <DialogDescription>
            {mode === "ios-safari"
              ? "Add Shotgun Ninjas Pool Hall to your home screen for an app-style launcher."
              : "Add Shotgun Ninjas Pool Hall to your Dock for one-click access."}
          </DialogDescription>
        </DialogHeader>
        {mode === "ios-safari" ? (
          <ol className="list-decimal pl-5 space-y-3 text-sm">
            <li>
              Tap the&nbsp;
              <span className="inline-flex items-center gap-1 align-middle text-primary border border-primary/40 rounded-md px-1.5 py-0.5">
                <ShareIosGlyph />
                <span className="font-mono text-[10px] tracking-widest uppercase">
                  Share
                </span>
              </span>
              &nbsp;icon at the bottom of Safari.
            </li>
            <li>
              Scroll and choose&nbsp;
              <strong>Add to Home Screen</strong>.
            </li>
            <li>
              Tap <strong>Add</strong> to confirm.
            </li>
          </ol>
        ) : (
          <ol className="list-decimal pl-5 space-y-3 text-sm">
            <li>
              Open the&nbsp;
              <span className="inline-block font-mono text-[11px] tracking-wider text-primary border border-primary/40 rounded-md px-1.5 py-0.5">
                File
              </span>
              &nbsp;menu in Safari.
            </li>
            <li>
              Choose&nbsp;
              <strong>Add to Dock…</strong>
            </li>
            <li>
              Confirm the name and icon, then click <strong>Add</strong>.
            </li>
          </ol>
        )}
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            data-testid="button-install-instructions-close"
          >
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function runInstallAction(
  mode: InstallMode,
  openInstructions: () => void,
): Promise<void> {
  if (mode === "native") {
    await triggerNativeInstall();
    return;
  }
  if (mode === "ios-safari" || mode === "macos-safari") {
    openInstructions();
  }
}

/** Banner shown at the top of the Main Menu. Hides itself when not
 *  installable, when already installed, or when previously dismissed. */
export function InstallBanner(): JSX.Element | null {
  const { mode, canInstall, dismissed } = useInstallState();
  const [showInstructions, setShowInstructions] = useState(false);

  if (!canInstall || dismissed) return null;

  const subtitle =
    mode === "native"
      ? "One tap to put Pool Hall on your home screen or desktop."
      : mode === "ios-safari"
        ? "Add it to your home screen for an app-style launcher."
        : "Add it to your Dock for one-click access.";

  return (
    <>
      <Card
        className="border-primary/40 bg-primary/5"
        data-testid="install-banner"
      >
        <CardContent className="p-3 flex items-center gap-3">
          <div className="text-primary shrink-0 w-10 h-10 rounded-md border border-primary/40 bg-primary/10 flex items-center justify-center">
            <Download className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="font-semibold uppercase tracking-wide text-sm">
                Install Shotgun Ninjas Pool Hall
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {subtitle}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              onClick={() =>
                runInstallAction(mode, () => setShowInstructions(true))
              }
              data-testid="button-install-app"
            >
              Install
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => dismissInstallPrompt()}
              aria-label="Dismiss install prompt"
              data-testid="button-install-dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
      {(mode === "ios-safari" || mode === "macos-safari") && (
        <InstructionsDialog
          mode={mode}
          open={showInstructions}
          onOpenChange={setShowInstructions}
        />
      )}
    </>
  );
}

/** Settings row — visible whenever installing is possible and the app is
 *  not already installed. Re-triggers the install flow even if the banner
 *  was dismissed. */
export function InstallSettingsRow(): JSX.Element | null {
  const { mode, canInstall } = useInstallState();
  const [showInstructions, setShowInstructions] = useState(false);

  if (!canInstall) return null;

  const desc =
    mode === "native"
      ? "Add Pool Hall to your home screen or desktop."
      : mode === "ios-safari"
        ? "Show the steps to add Pool Hall to your iOS home screen."
        : "Show the steps to add Pool Hall to your macOS Dock.";

  return (
    <>
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Install app</div>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
          <Button
            size="sm"
            onClick={() =>
              runInstallAction(mode, () => setShowInstructions(true))
            }
            data-testid="button-settings-install-app"
          >
            <Download className="h-4 w-4" />
            Install
          </Button>
        </CardContent>
      </Card>
      {(mode === "ios-safari" || mode === "macos-safari") && (
        <InstructionsDialog
          mode={mode}
          open={showInstructions}
          onOpenChange={setShowInstructions}
        />
      )}
    </>
  );
}
