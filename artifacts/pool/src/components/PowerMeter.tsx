import type { JSX } from "react";
import { Slider } from "@/components/ui/slider";
import { Zap } from "lucide-react";

interface PowerMeterProps {
  value: number; // 0..1
  onChange: (v: number) => void;
  disabled?: boolean;
}

export default function PowerMeter(props: PowerMeterProps): JSX.Element {
  const { value, onChange, disabled } = props;
  const pct = Math.round(value * 100);
  return (
    <div className="flex-1 flex items-center gap-3 min-w-0">
      <Zap
        className="h-5 w-5 shrink-0 text-primary"
        aria-hidden="true"
      />
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
      <span className="font-mono text-sm w-10 text-right tabular-nums" data-testid="text-power">
        {pct}%
      </span>
    </div>
  );
}
