import { RealtimeCameraFormat, cameraFormatSize } from "@xmaxai/web-sdk";

const RATIO_OPTIONS: readonly { label: string; presets: readonly RealtimeCameraFormat[] }[] = [
  { label: "16:9", presets: [RealtimeCameraFormat.resolution1920x1080, RealtimeCameraFormat.resolution1280x704] },
  { label: "9:16", presets: [RealtimeCameraFormat.resolution1080x1920, RealtimeCameraFormat.resolution704x1280] },
  { label: "1:1", presets: [RealtimeCameraFormat.resolution1408x1408, RealtimeCameraFormat.resolution960x960] },
  { label: "3:4", presets: [RealtimeCameraFormat.resolution1152x1536, RealtimeCameraFormat.resolution768x1024] },
  { label: "4:3", presets: [RealtimeCameraFormat.resolution1536x1152, RealtimeCameraFormat.resolution1024x768] },
];

interface CameraPresetPickerProps {
  value: RealtimeCameraFormat;
  presets: readonly RealtimeCameraFormat[];
  disabled?: boolean;
  onChange: (preset: RealtimeCameraFormat) => void;
}

/** 在画板内选择当前模型支持的摄像头比例。 */
export function CameraPresetPicker({ value, presets, disabled = false, onChange }: CameraPresetPickerProps) {
  return (
    <div className="cameraPresetPicker" role="radiogroup" aria-label="Camera aspect ratio">
      {RATIO_OPTIONS.map(({ label, presets: options }) => {
        const preset = options.find(option => presets.includes(option));
        const size = preset && !disabled ? cameraFormatSize(preset) : undefined;
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
