import { useEffect, useId, useState } from "react";
import type { VideoBeautyOptions } from "@xmaxai/web-sdk";
import { usePopoverInteraction } from "./usePopoverInteraction";

const BEAUTY_FIELDS = [
  { key: "smoothness", label: "磨皮强度" },
  { key: "lightening", label: "美白强度" },
  { key: "sharpness", label: "锐化强度" },
  { key: "redness", label: "红润强度" },
] as const;

interface ResultBeautyControlProps {
  enabled: boolean;
  options: Required<VideoBeautyOptions>;
  disabled?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onOptionsChange: (options: Required<VideoBeautyOptions>) => void;
}

/** 只处理生成结果视图，不改变输入视频或原始音视频录制。 */
export function ResultBeautyControl({ enabled, options, disabled = false, onEnabledChange, onOptionsChange }: ResultBeautyControlProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const expanded = open && !disabled;
  const { rootRef, buttonRef, onBlur } = usePopoverInteraction({
    open: expanded,
    initialFocus: 'input[type="checkbox"]',
    onOpenChange: setOpen,
  });

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="remoteVolumeControl" ref={rootRef} onBlur={onBlur}>
      <button ref={buttonRef} type="button" className={`remoteVolumeButton${enabled ? " active" : ""}`}
        disabled={disabled} title="生成结果美颜" aria-label={`结果美颜：${enabled ? "开启" : "关闭"}`}
        aria-expanded={expanded} aria-controls={expanded ? id : undefined} aria-haspopup="dialog"
        onClick={() => setOpen(value => !value)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
          <path d="M20 2v4m-2-2h4" />
        </svg>
      </button>
      {expanded && (
        <div className="remoteVolumePopover" id={id} role="dialog" aria-label="生成结果美颜">
          <div className="remoteVolumeHeading">
            <label htmlFor={`${id}-enabled`}>结果美颜</label>
            <input id={`${id}-enabled`} type="checkbox" checked={enabled}
              onChange={event => onEnabledChange(event.currentTarget.checked)} />
          </div>
          {BEAUTY_FIELDS.map(({ key, label }) => {
            const sliderId = `${id}-${key}`;
            const percent = Math.round(options[key] * 100);
            return (
              <div key={key}>
                <div className="remoteVolumeHeading resultEffectStrengthHeading">
                  <label htmlFor={sliderId}>{label}</label>
                  <output htmlFor={sliderId}>{percent}%</output>
                </div>
                <input id={sliderId} type="range" min="0" max="100" step="1" value={percent}
                  disabled={!enabled} aria-valuetext={`${percent}%`}
                  style={{ backgroundImage: `linear-gradient(to right, var(--accent) ${percent}%, #e9ebef ${percent}%)` }}
                  onChange={event => onOptionsChange({ ...options, [key]: Number(event.currentTarget.value) / 100 })} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
