import { RealtimeCameraPreset, RealtimeModel, cameraPresetSize, defaultCameraVideoFormat, supportedVideoFormats } from "@xmaxai/web-sdk";

/** 根据模型支持的预设选择摄像头尺寸，切换模型时尽量保留画面比例。 */
export function resolveCameraConfiguration(model: RealtimeModel, preset: RealtimeCameraPreset, isMobile: boolean) {
  const format = defaultCameraVideoFormat(model);
  if (model === RealtimeModel.x2_0) {
    const lockedPreset = isMobile ? RealtimeCameraPreset.resolution1080x1920 : RealtimeCameraPreset.resolution1920x1080;
    return {
      preset: lockedPreset,
      presets: [lockedPreset],
      videoFormat: isMobile ? format : format.resized(format.height, format.width),
      isPresetLocked: true,
    };
  }

  const supportedSizes = new Set(supportedVideoFormats(model).map(({ width, height }) => `${width}x${height}`));
  const presets = Object.values(RealtimeCameraPreset).filter(candidate => supportedSizes.has(candidate));
  const requested = cameraPresetSize(preset);
  const aspect = requested.width / requested.height;
  let selected = preset;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of presets) {
    const { width, height } = cameraPresetSize(candidate);
    const candidateDistance = Math.abs(Math.log(aspect / (width / height)));
    if (candidateDistance < distance) {
      selected = candidate;
      distance = candidateDistance;
    }
  }
  const size = cameraPresetSize(selected);
  return {
    preset: selected,
    presets,
    videoFormat: format.resized(size.width, size.height),
    isPresetLocked: false,
  };
}
