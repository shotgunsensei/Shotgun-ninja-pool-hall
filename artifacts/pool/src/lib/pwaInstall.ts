import { useEffect, useState } from "react";

const DISMISS_KEY = "snph:pwa-install-dismissed";

export type InstallMode =
  | "native"
  | "ios-safari"
  | "macos-safari"
  | "installed"
  | "none";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface ModuleState {
  mode: InstallMode;
  promptEvent: BeforeInstallPromptEvent | null;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    /* ignore */
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!isIOS()) return false;
  const ua = navigator.userAgent || "";
  if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram|Line\//.test(ua)) {
    return false;
  }
  return /Safari/.test(ua);
}

function isMacOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (!/Macintosh/.test(ua)) return false;
  if (isIOS()) return false;
  if (/Chrome|Chromium|CriOS|FxiOS|Firefox|Edg/.test(ua)) return false;
  return /Safari/.test(ua);
}

function detectInitialMode(): InstallMode {
  if (typeof window === "undefined") return "none";
  if (isStandalone()) return "installed";
  if (isIOSSafari()) return "ios-safari";
  if (isMacOSSafari()) return "macos-safari";
  // Other browsers: stay "none" until beforeinstallprompt fires (if ever).
  return "none";
}

const moduleState: ModuleState = {
  mode: detectInitialMode(),
  promptEvent: null,
};

const stateListeners = new Set<(s: ModuleState) => void>();
const dismissListeners = new Set<() => void>();

function setModuleState(patch: Partial<ModuleState>): void {
  Object.assign(moduleState, patch);
  for (const l of stateListeners) l(moduleState);
}

function notifyDismissChanged(): void {
  for (const l of dismissListeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    setModuleState({
      mode: "native",
      promptEvent: e as BeforeInstallPromptEvent,
    });
  });
  window.addEventListener("appinstalled", () => {
    setModuleState({ mode: "installed", promptEvent: null });
    try {
      window.localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* ignore */
    }
    notifyDismissChanged();
  });
  try {
    const mql = window.matchMedia("(display-mode: standalone)");
    const handler = (): void => {
      if (mql.matches) {
        setModuleState({ mode: "installed", promptEvent: null });
      }
    };
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
    }
  } catch {
    /* ignore */
  }
}

export function isInstallDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(DISMISS_KEY, "1");
    else window.localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

export function dismissInstallPrompt(): void {
  writeDismissed(true);
  notifyDismissChanged();
}

export function resetInstallDismissed(): void {
  writeDismissed(false);
  notifyDismissChanged();
}

export async function triggerNativeInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const ev = moduleState.promptEvent;
  if (!ev) return "unavailable";
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    // Per spec, the captured event can only be used once.
    setModuleState({
      promptEvent: null,
      mode: choice.outcome === "accepted" ? "installed" : "none",
    });
    if (choice.outcome === "accepted") {
      writeDismissed(false);
      notifyDismissChanged();
    }
    return choice.outcome;
  } catch {
    setModuleState({ promptEvent: null, mode: "none" });
    return "unavailable";
  }
}

export interface InstallStateInfo {
  mode: InstallMode;
  /** True when the app is installable via either native prompt or guided
   *  instructions on the current browser. */
  canInstall: boolean;
  /** True if the user has previously dismissed the banner. */
  dismissed: boolean;
}

export function useInstallState(): InstallStateInfo {
  const [snap, setSnap] = useState<ModuleState>(moduleState);
  const [dismissed, setDismissed] = useState<boolean>(isInstallDismissed());
  useEffect(() => {
    const onState = (next: ModuleState): void => setSnap({ ...next });
    stateListeners.add(onState);
    const onDismiss = (): void => setDismissed(isInstallDismissed());
    dismissListeners.add(onDismiss);
    // Sync any state captured between render and effect mount.
    setSnap({ ...moduleState });
    setDismissed(isInstallDismissed());
    const onStorage = (ev: StorageEvent): void => {
      if (ev.key === DISMISS_KEY) setDismissed(isInstallDismissed());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      stateListeners.delete(onState);
      dismissListeners.delete(onDismiss);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const canInstall =
    snap.mode === "native" ||
    snap.mode === "ios-safari" ||
    snap.mode === "macos-safari";
  return { mode: snap.mode, canInstall, dismissed };
}
