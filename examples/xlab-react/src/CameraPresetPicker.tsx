import { RealtimeCameraPreset } from "@xmaxai/web-sdk";

const PRESET_LABELS: Record<RealtimeCameraPreset, string> = {
  [RealtimeCameraPreset.resolution1920x1080]: "16:9",
  [RealtimeCameraPreset.resolution1080x1920]: "9:16",
  [RealtimeCameraPreset.resolution1408x1408]: "1:1",
  [RealtimeCameraPreset.resolution1152x1536]: "3:4",
  [RealtimeCameraPreset.resolution1536x1152]: "4:3",
};

interface CameraPresetPickerProps {
  value: RealtimeCameraPreset;
  disabled?: boolean;
  onChange: (preset: RealtimeCameraPreset) => void;
}

/** 首页摄像头比例选择，与模型选择器共用胶囊样式。 */
export function CameraPresetPicker({ value, disabled = false, onChange }: CameraPresetPickerProps) {
  return (
    <div className="rtcModelPicker">
      <select
        className="rtcModelSelect"
        aria-label="Camera aspect ratio"
        title="Camera aspect ratio"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as RealtimeCameraPreset)}
      >
        {Object.values(RealtimeCameraPreset).map((preset) => (
          <option key={preset} value={preset}>{PRESET_LABELS[preset]}</option>
        ))}
      </select>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
