import type { JSX } from "react";
import { Slider } from "@/components/ui/slider";

interface PowerMeterProps {
  value: number; // 0..1
  onChange: (v: number) => void;
  disabled?: boolean;
}

export default function PowerMeter(props: PowerMeterProps): JSX.Element {
  const { value, onChange, disabled } = props;
  const pct = Math.round(value * 100);
  return (
    <div className="flex flex-1 items-center gap-2 min-w-0">
      <div className="flex-1 min-w-0">
        <Slider
          value={[pct]}
          min={10}
          max={100}
          step={1}
          onValueChange={(v) => onChange((v[0] ?? 50) / 100)}
          disabled={disabled}
          aria-label="Shot power"
          data-testid="slider-power"
        />
      </div>
      <span
        className="font-mono text-xs w-8 text-right tabular-nums text-muted-foreground"
        data-testid="text-power"
      >
        {pct}%
      </span>
    </div>
  );
}
