//
//  XmaxRealtimeManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import type { CameraRotation } from "../../Foundation/Media/Camera/CameraRotation";
import type { RealtimeNetworkQualityListener } from "../../Foundation/RTC/NetworkStatistics";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeExtraParams } from "../../Service/Realtime/RealtimeExtraParams";
import type { RealtimeMediaFrameListener } from "../../Service/Realtime/RealtimeMediaFrame";
import type { RemoteMediaTracks } from "../../Foundation/Media/RemoteMediaTracks";
import type { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type {
  RealtimeState,
  RealtimeStateListener,
} from "../../Service/Realtime/RealtimeState";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RealtimeConfiguration } from "./RealtimeConfiguration";
import type { RealtimeTimingListener } from "../../Service/Realtime/RealtimeTiming";
import type { DownlinkVideoStatisticsListener, UplinkVideoStatisticsListener } from "../../Foundation/RTC/VideoStatistics";
import type { RealtimeCameraPreset } from "./RealtimeCameraPreset";
import type { RealtimeQualityLevel } from "./RealtimeQualityLevel";
import type { RealtimeExternalVideoStreamOptions } from "../../Media/External/RealtimeExternalVideoSource";

/**
 * The realtime media and generation capabilities exposed to your app.
 */
export interface XmaxRealtimeManaging {

  /**
   * Observes the result stream's original browser audio and video tracks, immediately replaying the
   * current binding.
   *
   * Supports native APIs such as MediaRecorder without requiring WebCodecs. Tracks are borrowed; clone
   * them before modifying or stopping them, and never stop the SDK's originals. Undefined reports no
   * result stream or removes the listener when passed as the argument. Observation does not change
   * subscriptions, volume, or generation, may coexist with frame observation, and is cleared on close().
   */
  setRemoteMediaTracksListener(
    listener?: (
      tracks?: RemoteMediaTracks
    ) => void
  ): void;

  /**
   * Observes decoded remote video and PCM audio before playback-volume processing.
   *
   * Both tracks use receiver presentation timestamps in microseconds; synchronize by timestamp, not
   * callback arrival. Your app must close delivered video frames and keep callbacks lightweight. Queue
   * overflow or stream replacement marks discontinuity. Call from a user gesture and await preparation.
   * Unsupported browsers or RTC providers reject without terminating generation. Observation may begin
   * before or during generation; undefined releases observation resources without changing volume,
   * subscriptions, or tasks. Browser presentation callbacks may skip frames; delivery of every received
   * or decoded frame is not guaranteed. Missing audio is not replaced with synthetic silence.
   */
  setRemoteMediaFrameListener(
    listener?: RealtimeMediaFrameListener
  ): Promise<void>;

  /**
   * The realtime capability configuration.
   */
  readonly options: RealtimeConfiguration;

  /**
   * The current connection and generation state.
   */
  readonly currentState: RealtimeState;

  /**
   * The camera media format, unaffected by uplink quality changes; undefined without a camera stream.
   */
  readonly currentCameraVideoFormat?: RealtimeVideoFormat;

  /**
   * The preset matching the camera dimensions; undefined without a camera or a matching preset.
   */
  readonly currentCameraPreset?: RealtimeCameraPreset;

  /**
   * Updates a ready, disconnected camera's format while retaining its SDK track and view binding. A
   * preset preserves frame rate, bitrate, and encoding preference; model sizing rules still apply.
   */
  updateCameraFormat(
    format: RealtimeVideoFormat | RealtimeCameraPreset
  ): Promise<void>;

  /**
   * The successfully applied uplink level; undefined when disconnected or no local uplink exists.
   */
  readonly uplinkQualityLevel?: RealtimeQualityLevel;

  /**
   * The submitted downlink level; undefined before generation or while disconnected. Returned media may
   * reflect the change later.
   */
  readonly downlinkQualityLevel?: RealtimeQualityLevel;

  /**
   * Sets the uplink encoding level during generation without changing capture format or the generation
   * canvas. Automatic adaptation resumes from this level for Agora and TRTC; VeRTC applies manual levels
   * only.
   */
  setUplinkQualityLevel(
    level: RealtimeQualityLevel
  ): Promise<void>;

  /**
   * Sets the downlink level during generation, continuing enabled adaptation from that level. Successful
   * submission does not mean the server has returned the new dimensions.
   */
  setDownlinkQualityLevel(
    level: RealtimeQualityLevel
  ): Promise<void>;

  /**
   * Moves uplink quality one level during generation when local media is published. Agora and VeRTC
   * adjust dimensions, frame rate, and bitrate; TRTC adjusts frame rate only. The L1 baseline, downlink
   * size, and enabled adaptation remain unchanged.
   *
   * @param direction - The adjustment direction; L1/L5 boundaries do not reapply the same level.
   */
  adjustUplinkQuality(
    direction: "upgrade" | "downgrade"
  ): Promise<void>;

  /**
   * Moves downlink output dimensions one level during generation. Only resolution changes; the level
   * updates after successful submission and enabled adaptation continues. Boundaries do not resend the
   * same level; submission does not confirm server-side application.
   */
  adjustDownlinkQuality(
    direction: "upgrade" | "downgrade"
  ): Promise<void>;

  /**
   * The local preview audio volume, from 0 to 1.
   */
  readonly localAudioVolume: number;

  /**
   * The remote generated audio playback volume, from 0 to 1.
   */
  readonly remoteAudioVolume: number;

  /**
   * Sets the realtime state listener.
   *
   * @param listener - The callback; undefined removes it.
   */
  setStateListener(
    listener?: RealtimeStateListener
  ): Promise<void>;

  /**
   * Observes uplink and downlink network quality, immediately replaying the latest snapshot. Undefined
   * reports no sample or disconnection, or removes the listener when supplied. Logging and generated
   * media are independent; observer failures do not affect the lifecycle.
   */
  setNetworkQualityListener(
    listener?: RealtimeNetworkQualityListener
  ): Promise<void>;

  /**
   * Observes startup durations, replaying the snapshot immediately and after each completed stage. A new
   * media source resets timing; failure or termination freezes completed stages. Condition updates do
   * not reset it. First-frame timing requires an SDK video view and does not block startGeneration.
   * Undefined removes the listener; observer failures do not affect generation. Performance logging
   * independently emits one console.info summary after render warmup.
   */
  setTimingListener(
    listener?: RealtimeTimingListener
  ): Promise<void>;

  /**
   * Observes uplink dimensions, capture/encoding/send frame rates, bitrate, and loss independently of
   * logging. Replays the latest snapshot immediately; undefined reports missing statistics or
   * stopped/disconnected media, or removes the listener when supplied. Observer failures do not affect
   * generation.
   */
  setUplinkVideoStatisticsListener(
    listener?: UplinkVideoStatisticsListener
  ): Promise<void>;

  /**
   * Observes downlink dimensions, decode/RTC-render frame rates, bitrate, loss, and estimated media E2E
   * delay. Replays the latest snapshot independently of logging; undefined reports a cleared or missing
   * stream, or removes the listener when supplied. Observer failures do not affect generation.
   */
  setDownlinkVideoStatisticsListener(
    listener?: DownlinkVideoStatisticsListener
  ): Promise<void>;

  /**
   * Sets local media preview volume.
   *
   * @throws Rejects if the volume is outside the valid range.
   */
  setLocalAudioVolume(
    volume: number
  ): Promise<void>;

  /**
   * Sets remote generated audio playback volume. Saves the setting before connection or subscription and
   * applies it before remote playback begins.
   *
   * @throws Rejects if the volume is invalid or the RTC volume update fails.
   */
  setRemoteAudioVolume(
    volume: number
  ): Promise<void>;

  /**
   * Creates a local camera stream and starts preview.
   *
   * Bind the returned track to a preview view; ready is entered after a valid frame arrives and the view
   * is bound.
   *
   * @param options.position - The front or rear camera.
   * @param options.useMicrophone - Whether to capture and publish microphone audio.
   * @param options.rotation - Clockwise input rotation, defaulting to 0; nonzero rotation currently
   * requires Agora. Preview and upload are corrected independently of mirroring.
   * @param options.enableFrameValidation - Whether to wait for a fixed 200 ms camera warmup before
   * publishing; defaults to true. False skips the wait.
   * @param options.videoFormat - The post-rotation target format, resolved using model sizing rules.
   * @param options.preset - A preset with the recommended frame rate, instead of videoFormat. Supply
   * exactly one.
   * @returns A media stream containing the local camera video track.
   * @throws Rejects for unsupported camera input, invalid configuration, denied permission, or capture
   * startup failure.
   */
  createLocalCameraStream(
    options: {
      position: CameraPosition;
      useMicrophone: boolean;
      rotation?: CameraRotation;
      enableFrameValidation?: boolean;
    } & (
        | {
          videoFormat: RealtimeVideoFormat;
          preset?: never
        }
        | {
          preset: RealtimeCameraPreset;
          videoFormat?: never
        }
      )
  ): Promise<RealtimeMediaStream>;

  /**
   * Creates a local File/Blob video source for TRTC, Agora, or VeRTC without accessing capture devices.
   *
   * Canvas scaling preserves all content within media-sizing limits. File audio is published
   * independently and local preview stays muted. The SDK selects the generation canvas separately and
   * requests server-side contain padding only when aspect ratios differ. Call directly from a user
   * gesture to unlock playback. Creation pauses on the first frame; startGeneration starts playback.
   *
   * @param options.file - A local File or Blob containing decodable video.
   * @param options.videoFormat - Frame rate and encoding settings; width and height are compatibility
   * inputs, while media dimensions come from the file.
   * @param options.loop - Whether to loop audio and video; defaults to true.
   * @param options.includeAudio - Whether to publish file audio; defaults to true. Files without audio
   * produce silence; false creates no audio track.
   * @throws Rejects for unsupported providers, invalid files or formats, decoding failure, or blocked
   * playback.
   */
  createLocalVideoStream(
    options: {
      file: Blob;
      videoFormat: RealtimeVideoFormat;
      loop?: boolean;
      includeAudio?: boolean;
    }
  ): Promise<RealtimeMediaStream>;

  /**
   * Creates a still-image video stream from a local File/Blob for TRTC, Agora, or VeRTC.
   *
   * Scaling preserves all image content within media-sizing limits. The same still frame is sent
   * continuously without uploading the file or using capture devices. The generation canvas is selected
   * separately, with server-side contain padding only when aspect ratios differ. Preview is available
   * after creation; startGeneration is still required. Disconnect retains the source; close releases it.
   *
   * @param options.file - A browser-decodable image; animated images use one decoded still snapshot.
   * @param options.videoFormat - Frame rate and encoding settings; width and height remain compatibility
   * inputs, while media dimensions come from the image.
   * @throws Rejects for invalid files or formats, decoding failure, missing Canvas capture, or an active
   * media source.
   */
  createLocalImageStream(
    options: {
      file: Blob;
      videoFormat: RealtimeVideoFormat;
    }
  ): Promise<RealtimeMediaStream>;

  /**
   * Binds an external frame source or a compatible video-only browser track without requesting device
   * access or playing input audio.
   *
   * The source path calls start(sink), supports optional PCM, and becomes ready without waiting for a
   * first frame. The SDK limits frame area, aligns dimensions to four pixels, scales frames, and
   * supplies preview. Your app supplies upright, correctly mirrored pixels. The videoTrack/videoFormat
   * path clones only the video track, without processing pixels or installing a preview binding.
   * Disconnect retains source and preview but discards audio; stopExternalVideoStream or close
   * invalidates the sink and calls source.stop(). Audio requires a user gesture, secure context, and
   * AudioWorklet support.
   *
   * @param options.source - Your app's frame source, mutually exclusive with videoTrack/videoFormat.
   * @param options.videoTrack - A live video track for the compatibility path.
   * @param options.videoFormat - The compatibility track's source dimensions, frame rate, and encoding
   * settings.
   * @throws Rejects and cleans up this binding for invalid configuration, active media, source startup
   * failure, or RTC preparation failure.
   */
  createExternalVideoStream(
    options: RealtimeExternalVideoStreamOptions
  ): Promise<RealtimeMediaStream>;

  /**
   * Unbinds a disconnected external source, clears preview, and releases SDK outputs without taking
   * ownership of capture devices. Disconnect first if connected. Other source types are unchanged.
   */
  stopExternalVideoStream(): Promise<void>;

  /**
   * Updates local uplink encoding immediately without reconnecting or restarting generation.
   *
   * Supply a complete format; omitted bitrate and encoding preferences use RealtimeVideoFormat defaults.
   * Dimensions align downward to four pixels, preferring the exact aspect ratio; other supplied settings
   * are retained. The local track records the aligned format for reconnection, while generation
   * continues using the original media format. Actual transmission depends on device, browser, and
   * network conditions; verify it through statistics. The applied format becomes the new adaptive L1
   * baseline. Agora scales dimensions and frame rate; TRTC adjusts frame rate only.
   *
   * @param videoFormat - The complete uplink dimensions, frame rate, and encoding configuration.
   * @throws Rejects without a local source, during conflicting operations, for invalid settings, or when
   * the RTC update fails.
   */
  updateUplinkVideoFormat(
    videoFormat: RealtimeVideoFormat
  ): Promise<void>;

  /**
   * Updates uplink frame rate after connection, preserving the applied dimensions, bitrate bounds, and
   * encoding preference. The updated track format persists across reconnection without changing
   * generation or output dimensions. Manual updates reset quality samples and establish a new adaptive
   * L1 baseline. This experimental operation resubmits the complete encoder configuration; RTC
   * adaptation state may change. Verify actual results through statistics.
   */
  updateUplinkFrameRate(
    fps: number
  ): Promise<void>;

  /**
   * Stops local camera capture and releases preview and RTC resources.
   */
  stopLocalCameraStream(): Promise<void>;

  /**
   * Switches between front and rear cameras.
   *
   * During generation, stops the task, switches capture, and restores generation with cached conditions
   * while retaining the RTC connection. Switching is unavailable during connection or generation
   * startup.
   *
   * @returns The local stream with the same SDK video track and updated camera position.
   */
  switchCamera(): Promise<RealtimeMediaStream>;

  /**
   * Connects a local stream created by this manager.
   *
   * Creates a session, joins the RTC room, publishes local media, and starts heartbeats. Enabled camera
   * validation waits for a fixed 200 ms warmup in parallel with connection, before publishing. The
   * returned remote stream carries results once generation starts.
   *
   * @param localStream - This manager's camera, external, local-image, or file-video stream.
   * @returns A remote stream placeholder for generated media.
   * @throws Rejects for foreign streams, an active connection, or session, join, or publication
   * failures. Failure releases connection resources and restores local preview.
   */
  connect(
    localStream: RealtimeMediaStream
  ): Promise<RealtimeMediaStream>;

  /**
   * Disconnects while retaining the current local media preview.
   */
  disconnect(): Promise<void>;

  /**
   * Closes the lifecycle and releases connection, local media, and RTC resources. Concurrent calls await
   * the same cleanup. Local streams can be created again after closure.
   */
  close(): Promise<void>;

  /**
   * Connects if needed and starts generation.
   *
   * Active generation updates conditions unless restart is true. The first task requires a context;
   * later calls may reuse cached conditions. Mount the returned remote stream in an SDK video view;
   * generating is entered only after the first frame and render warmup.
   *
   * @param options.localStream - This manager's local camera, external, image, or video-file stream.
   * @param options.context - The generation conditions; omission reuses cached conditions.
   * @param options.restart - Whether to retain RTC and start a new task without first sending stop;
   * defaults to false.
   * @param options.faceRestoration - Whether to restore the original face; defaults to false and updates
   * active tasks through change_condition.
   * @param options.extraParams - Additional start/change_condition parameters. Not cached or included in
   * automatic recovery; SDK fields cannot be overridden.
   * @returns A mountable remote stream without waiting for warmup; generating signals presentation
   * readiness.
   * @throws Rejects with invalidConfiguration for non-JSON, cyclic, or reserved extra parameters before
   * connection or condition updates.
   * @throws Rejects for foreign media, missing conditions, signaling failure, or unconfirmed generation,
   * stopping the task and releasing connection resources.
   */
  startGeneration(
    options: {
      localStream: RealtimeMediaStream;
      context?: RealtimeContext;
      restart?: boolean;
      faceRestoration?: boolean;
      extraParams?: RealtimeExtraParams;
    }
  ): Promise<RealtimeMediaStream>;
}
