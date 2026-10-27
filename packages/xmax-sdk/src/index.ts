//
//  index.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Core
 */
export { XmaxClient } from "./Core/XmaxClient";
export { XmaxConfiguration } from "./Core/XmaxConfiguration";
export type { XmaxConfigurationInit } from "./Core/XmaxConfiguration";

/**
 * Core / Realtime
 */
export { RealtimeConfiguration } from "./Core/Realtime/RealtimeConfiguration";
export { RealtimeCameraPreset, cameraPresetSize } from "./Core/Realtime/RealtimeCameraPreset";
export { RealtimeQualityLevel } from "./Core/Realtime/RealtimeQualityLevel";
export type { XmaxRealtimeManaging } from "./Core/Realtime/XmaxRealtimeManaging";

/**
 * Core / NonRealtime
 */
export type { XmaxNonRealtimeManaging, NonRealtimeWaitOptions } from "./Core/NonRealtime/XmaxNonRealtimeManaging";

/**
 * Service / NonRealtime
 */
export { NonRealtimeQuality, NonRealtimeTaskStatus } from "./Service/NonRealtime/NonRealtimeTask";
export type {
  NonRealtimeTask, NonRealtimeResult, NonRealtimeTaskOptions,
  NonRealtimeTaskListOptions, NonRealtimeTaskPage,
} from "./Service/NonRealtime/NonRealtimeTask";
export { NonRealtimeTaskError } from "./Service/NonRealtime/NonRealtimeTaskError";

/**
 * Foundation
 */
export { RealtimeNetworkQualityLevel } from "./Foundation/RTC/NetworkStatistics";
export type { RealtimeNetworkQuality, RealtimeNetworkQualityListener } from "./Foundation/RTC/NetworkStatistics";
export { XmaxError, XmaxErrorCode } from "./Foundation/Errors/XmaxError";
export type { XmaxErrorListener } from "./Foundation/Errors/XmaxError";
export { XmaxLogger, XmaxLoggerOption } from "./Foundation/Logging/XmaxLogger";
export { CameraPosition } from "./Foundation/Media/Camera/CameraPosition";
export type { CameraRotation } from "./Foundation/Media/Camera/CameraRotation";
export { RtcProvider } from "./Foundation/RTC/RtcProvider";
export { VideoContentMode } from "./Foundation/Media/Video/VideoContentMode";
export type {
  UplinkVideoStatistics,
  UplinkVideoStatisticsListener,
  DownlinkVideoStatistics,
  DownlinkVideoStatisticsListener,
} from "./Foundation/RTC/VideoStatistics";
export { XmaxEnvironment, apiBaseURL, realtimeApiBaseURL } from "./Foundation/Runtime/XmaxEnvironment";

/**
 * Service / Realtime
 */
export type {
  RealtimeLaunchTiming,
  RealtimeLaunchTimingListener,
} from "./Service/Realtime/RealtimeLaunchTiming";
export { RealtimeContext } from "./Service/Realtime/RealtimeContext";
export type { RealtimeContextInit } from "./Service/Realtime/RealtimeContext";
export { RealtimeMediaStream } from "./Service/Realtime/RealtimeMediaStream";
export {
  RealtimeModel,
  modelDisplayName,
  supportedRtcProviders,
  supportedVideoFormats,
  defaultCameraVideoFormat,
  defaultFrameRate,
} from "./Service/Realtime/RealtimeModel";
export type { RealtimeModelName } from "./Service/Realtime/RealtimeModel";
export {
  RealtimeConnectionState,
  RealtimeReason,
  RealtimeState,
} from "./Service/Realtime/RealtimeState";
export type { RealtimeStateListener } from "./Service/Realtime/RealtimeState";
export {
  RealtimeVideoEncoderPreference,
  RealtimeVideoFormat,
} from "./Service/Realtime/RealtimeVideoFormat";
export type { RealtimeVideoFormatInit } from "./Service/Realtime/RealtimeVideoFormat";
export { RealtimeVideoTrack } from "./Service/Realtime/RealtimeVideoTrack";
export type { JsonValue, RealtimeExtraParams } from "./Service/Realtime/RealtimeExtraParams";
export type { RealtimeAudioFrame, RealtimeVideoFrame, RealtimeMediaFrame, RealtimeMediaFrameListener } from "./Service/Realtime/RealtimeMediaFrame";

/**
 * Media / External
 */
export type { RealtimeExternalVideoSource, RealtimeExternalFrameSink, RealtimeExternalVideoStreamOptions } from "./Media/External/RealtimeExternalVideoSource";
export type { RealtimeExternalAudioFrame } from "./Foundation/Media/Audio/RealtimeExternalAudioFrame";

/**
 * Service / Media
 */
export { MediaService } from "./Service/Media/MediaService";
export type { MediaServicing } from "./Service/Media/MediaServicing";

/**
 * Service / Storage
 */
export { StorageService } from "./Service/Storage/StorageService";
export type {
  StorageServicing,
  StorageUploadOptions,
} from "./Service/Storage/StorageServicing";
export { StoredFile } from "./Service/Storage/StoredFile";

/**
 * Render
 */
export { XmaxRealtimeVideoView } from "./Render/Video/XmaxRealtimeVideoView";
export type { VideoRenderStatistics } from "./Render/Video/VideoRenderStatistics";
export { XmaxRealtimeDualVideoView } from "./Render/Video/XmaxRealtimeDualVideoView";
export { DefaultTrajectoryEffectRenderer } from "./Render/Trajectory/DefaultTrajectoryEffectRenderer";
export type { TrajectoryEffectRendering } from "./Render/Trajectory/TrajectoryEffectRendering";
export type { TrajectoryID, TrajectoryPoint } from "./Render/Trajectory/TrajectoryPoint";
