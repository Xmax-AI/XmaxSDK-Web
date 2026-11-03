import { useId } from "react";
import type { RealtimeVideoBeautyOptions } from "@xmaxai/web-sdk";

const BEAUTY_FIELDS = [
  { key: "smoothness", label: "磨皮强度" },
  { key: "lightening", label: "美白强度" },
  { key: "sharpness", label: "锐化强度" },
  { key: "redness", label: "红润强度" },
] as const;

interface ResultBeautyControlProps {
  enabled: boolean;
  disabled?: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

interface ResultBeautyPanelProps {
  enabled: boolean;
  options: Required<RealtimeVideoBeautyOptions>;
  disabled?: boolean;
  onOptionsChange: (options: Required<RealtimeVideoBeautyOptions>) => void;
}

/** 顶栏按钮直接开关结果美颜，开启时显示画面内的调节面板。 */
export function ResultBeautyControl({ enabled, disabled = false, onEnabledChange }: ResultBeautyControlProps) {
  return (
    <button type="button" className={`remoteVolumeButton resultBeautyButton${enabled ? " active" : ""}`}
      disabled={disabled} title={enabled ? "关闭结果美颜" : "开启结果美颜"}
      aria-label="结果美颜" aria-pressed={enabled}
      onClick={() => onEnabledChange(!enabled)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
        <path d="M20 2v4m-2-2h4" />
      </svg>
    </button>
  );
}

/** 与统计浮层使用相同的半透明背景，固定在结果画面右下角。 */
export function ResultBeautyPanel({ enabled, options, disabled = false, onOptionsChange }: ResultBeautyPanelProps) {
  const id = useId();
  if (!enabled) return null;

  return (
    <section className="resultBeautyPanel" aria-label="结果美颜调节">
      {BEAUTY_FIELDS.map(({ key, label }) => {
        const sliderId = `${id}-${key}`;
        const percent = Math.round(options[key] * 100);
        return (
          <div className="resultBeautyRow" key={key}>
            <label htmlFor={sliderId}>{label}</label>
            <input id={sliderId} type="range" min="0" max="100" step="1" value={percent}
              disabled={disabled} aria-valuetext={`${percent}%`}
              style={{ backgroundImage: `linear-gradient(to right, #a9b4ff ${percent}%, rgba(255, 255, 255, 0.25) ${percent}%)` }}
              onChange={event => onOptionsChange({ ...options, [key]: Number(event.currentTarget.value) / 100 })} />
            <output htmlFor={sliderId}>{percent}%</output>
          </div>
        );
      })}
    </section>
  );
}
