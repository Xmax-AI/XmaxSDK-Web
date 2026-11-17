import { RealtimeCameraFormat, RealtimeModel, cameraFormatSize, defaultCameraVideoFormat, supportedVideoFormats } from "@xmaxai/web-sdk";

const COMMON_CAPTURE_RESOLUTIONS = ([
  [640, 480],
  [1280, 720],
  [720, 1280],
  [1920, 1080],
  [1080, 1920],
  [2560, 1440],
  [3840, 2160],
] as const).map(([width, height]) => ({ width, height, key: `${width}×${height}` }));

/** Lists preferred capture sizes within the bounds reported by the browser. */
export function captureResolutionOptions(capabilities?: Pick<MediaTrackCapabilities, "width" | "height">) {
  const { width, height } = capabilities ?? {};
  return COMMON_CAPTURE_RESOLUTIONS.filter(size =>
    size.width >= (width?.min ?? 0) && size.width <= (width?.max ?? Infinity) &&
    size.height >= (height?.min ?? 0) && size.height <= (height?.max ?? Infinity),
  );
}

/** 根据模型支持的预设选择摄像头尺寸，切换模型时尽量保留画面比例。 */
export function resolveCameraConfiguration(model: RealtimeModel, preset: RealtimeCameraFormat, isMobile: boolean) {
  const format = defaultCameraVideoFormat(model);
  if (model === RealtimeModel.x2_0) {
    const lockedPreset = isMobile ? RealtimeCameraFormat.resolution1080x1920 : RealtimeCameraFormat.resolution1920x1080;
    return {
      preset: lockedPreset,
      presets: [lockedPreset],
      videoFormat: isMobile ? format : format.resized(format.height, format.width),
      isPresetLocked: true,
    };
  }

  const supportedSizes = new Set(supportedVideoFormats(model).map(({ width, height }) => `${width}x${height}`));
  const presets = Object.values(RealtimeCameraFormat).filter(candidate => supportedSizes.has(candidate));
  const requested = cameraFormatSize(preset);
  const aspect = requested.width / requested.height;
  let selected = preset;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of presets) {
    const { width, height } = cameraFormatSize(candidate);
    const candidateDistance = Math.abs(Math.log(aspect / (width / height)));
    if (candidateDistance < distance) {
      selected = candidate;
      distance = candidateDistance;
    }
  }
  const size = cameraFormatSize(selected);
  return {
    preset: selected,
    presets,
    videoFormat: format.resized(size.width, size.height),
    isPresetLocked: false,
  };
}
