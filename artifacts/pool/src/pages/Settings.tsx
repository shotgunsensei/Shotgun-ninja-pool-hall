import type { JSX } from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/lib/settings";
import { InstallSettingsRow } from "@/components/InstallPrompt";

export default function SettingsPage(): JSX.Element {
  const [, navigate] = useLocation();
  const [settings, setSettings] = useSettings();

  return (
    <div className="min-h-[100dvh] w-full flex flex-col">
      <header className="px-3 pt-3 pb-2 flex items-center gap-2 border-b border-card-border bg-card/70">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => navigate("/")}
          aria-label="Back to menu"
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="font-semibold uppercase tracking-wider text-sm">
          <span className="text-primary">SYS::CONFIG</span> · Settings
        </h2>
      </header>

      <main className="flex-1 p-4 max-w-md w-full mx-auto flex flex-col gap-3">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <Label className="text-sm font-semibold">Aim guide</Label>
              <p className="text-xs text-muted-foreground">Show a dashed line where the cue is pointing.</p>
            </div>
            <Switch
              checked={settings.aimGuide}
              onCheckedChange={(v) => setSettings({ aimGuide: v })}
              data-testid="switch-aim-guide"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex flex-col gap-3">
            <div>
              <Label className="text-sm font-semibold">Table speed</Label>
              <p className="text-xs text-muted-foreground">
                Higher = balls travel further before stopping.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Slider
                value={[Math.round(settings.tableSpeed * 100)]}
                min={60}
                max={140}
                step={5}
                onValueChange={(v) => setSettings({ tableSpeed: (v[0] ?? 100) / 100 })}
                data-testid="slider-table-speed"
              />
              <span className="font-mono text-sm w-10 text-right">
                {Math.round(settings.tableSpeed * 100)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <Label className="text-sm font-semibold">Sound</Label>
              <p className="text-xs text-muted-foreground">Cue clicks and pocket thuds.</p>
            </div>
            <Switch
              checked={settings.sound}
              onCheckedChange={(v) => setSettings({ sound: v })}
              data-testid="switch-sound"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <Label className="text-sm font-semibold">Vibration</Label>
              <p className="text-xs text-muted-foreground">Haptic feedback on Android (where supported).</p>
            </div>
            <Switch
              checked={settings.vibration}
              onCheckedChange={(v) => setSettings({ vibration: v })}
              data-testid="switch-vibration"
            />
          </CardContent>
        </Card>

        <InstallSettingsRow />
      </main>
    </div>
  );
}
