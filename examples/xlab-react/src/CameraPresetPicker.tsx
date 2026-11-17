import { RealtimeCameraPreset, cameraPresetSize } from "@xmaxai/web-sdk";

const RATIO_OPTIONS: readonly { label: string; presets: readonly RealtimeCameraPreset[] }[] = [
  { label: "16:9", presets: [RealtimeCameraPreset.resolution1920x1080, RealtimeCameraPreset.resolution1280x704] },
  { label: "9:16", presets: [RealtimeCameraPreset.resolution1080x1920, RealtimeCameraPreset.resolution704x1280] },
  { label: "1:1", presets: [RealtimeCameraPreset.resolution1408x1408, RealtimeCameraPreset.resolution960x960] },
  { label: "3:4", presets: [RealtimeCameraPreset.resolution1152x1536, RealtimeCameraPreset.resolution768x1024] },
  { label: "4:3", presets: [RealtimeCameraPreset.resolution1536x1152, RealtimeCameraPreset.resolution1024x768] },
];

interface CameraPresetPickerProps {
  value: RealtimeCameraPreset;
  presets: readonly RealtimeCameraPreset[];
  disabled?: boolean;
  onChange: (preset: RealtimeCameraPreset) => void;
}

/** 在画板内选择当前模型支持的摄像头比例。 */
export function CameraPresetPicker({ value, presets, disabled = false, onChange }: CameraPresetPickerProps) {
  return (
    <div className="cameraPresetPicker" role="radiogroup" aria-label="Camera aspect ratio">
      {RATIO_OPTIONS.map(({ label, presets: options }) => {
        const preset = options.find(option => presets.includes(option));
        const size = preset && !disabled ? cameraPresetSize(preset) : undefined;
        return (
          <label className="cameraPresetOption" key={label} title={size && `${size.width} × ${size.height}`}>
            <input
              type="radio"
              name="camera-preset"
              aria-label={label}
              value={preset}
              checked={preset === value}
              disabled={disabled || preset === undefined}
              onChange={() => {
                if (preset !== undefined) onChange(preset);
              }}
            />
            <span>{label}</span>
          </label>
        );
      })}
    </div>
  );
}
