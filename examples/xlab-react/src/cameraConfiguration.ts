import { RealtimeCameraPreset, RealtimeModel, cameraPresetSize, defaultCameraVideoFormat } from "@xmaxai/web-sdk";

/** Example 的摄像头配置：X2.0 固定使用默认尺寸，X2.1 按用户选择的预设采集。 */
export function resolveCameraConfiguration(model: RealtimeModel, preset: RealtimeCameraPreset, isMobile: boolean) {
  const format = defaultCameraVideoFormat(model);
  if (model === RealtimeModel.x2_0) {
    return {
      preset: isMobile ? RealtimeCameraPreset.resolution1080x1920 : RealtimeCameraPreset.resolution1920x1080,
      videoFormat: isMobile ? format : format.resized(format.height, format.width),
      isPresetLocked: true,
    };
  }

  const size = cameraPresetSize(preset);
  return {
    preset,
    videoFormat: format.resized(size.width, size.height),
    isPresetLocked: false,
  };
}
