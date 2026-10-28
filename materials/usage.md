# Usage guide

Start with the [Quick Start](../README.md#quick-start) for camera input and video
rendering. Unless stated otherwise, the examples below reuse its `client`,
`realtime`, `localStream`, and `videoView`. Import `RealtimeVideoFormat` from
`@xmaxai/web-sdk` for the additional input and encoding examples. Files are supplied
by your app. Keep realtime operations tied to your screen's lifecycle and handle
async failures with `try/catch`.

- [Camera formats](#camera-formats)
- [Encoding and quality levels](#encoding-and-quality-levels)
- [Reference images](#reference-images)
- [Image and video inputs](#image-and-video-inputs)
- [Media and generation sizes](#media-and-generation-sizes)
- [External video and PCM input](#external-video-and-pcm-input)
- [Generated audio and video frames](#generated-audio-and-video-frames)
- [React](#react)
- [Touch interaction](#touch-interaction)
- [Statistics and quality monitoring](#statistics-and-quality-monitoring)
- [Lifecycle and errors](#lifecycle-and-errors)
- [Recording in XLab](#recording-in-xlab)

## Camera formats

Provide either `preset` or `videoFormat`, not both. A preset selects a model-supported
resolution and the model's recommended frame rate. To specify your own frame rate
or bitrate options, pass a `RealtimeVideoFormat` through `videoFormat` instead.
Models without fixed presets, such as X2.0, require `videoFormat`.

`RealtimeModel.x2_1` uses Agora and supports 1920×1080, 1080×1920, 1408×1408,
1152×1536, and 1536×1152. `RealtimeModel.x2_0` uses VeRTC, defaults to 832×1472,
and resolves other dimensions within its pixel budget. Select `XmaxEnvironment.china`
or `XmaxEnvironment.global` in the client configuration for the corresponding
realtime service.

Once the camera preview reaches `RealtimeConnectionState.ready`, you can change
its format before connecting. Presets retain the current frame rate and bitrate options:

```javascript
import { RealtimeCameraPreset } from "@xmaxai/web-sdk";

await realtime.updateCameraFormat(RealtimeCameraPreset.resolution1408x1408);
console.log(realtime.currentCameraVideoFormat, realtime.currentCameraPreset);
```

<br>

## Encoding and quality levels

During generation, select an uplink or downlink quality level directly:

```javascript
import { RealtimeQualityLevel } from "@xmaxai/web-sdk";

await realtime.setUplinkQualityLevel(RealtimeQualityLevel.l3);
await realtime.setDownlinkQualityLevel(RealtimeQualityLevel.l2);
console.log(realtime.uplinkQualityLevel, realtime.downlinkQualityLevel);
```

Automatic adaptation continues after a manual change on supported RTC providers;
VeRTC applies manual levels only. L5 scales width and height to 50% of the media
baseline. The default uplink minimum bitrate is 500 kbps, capped at the selected
maximum bitrate; explicit bitrate settings take precedence.

Use `updateUplinkVideoFormat` after creating the local camera stream, including during
generation, to change upstream encoding without reconnecting or restarting the task.

Dimensions are rounded down to multiples of four, preserving the exact aspect ratio
when possible. The local track's `videoFormat` reflects the aligned dimensions.

```javascript
await realtime.updateUplinkVideoFormat(new RealtimeVideoFormat({
  width: 1024,
  height: 1920,
  fps: 20,
  minimumBitrate: 1000,
  maximumBitrate: 2000,
}));
```

<br>

## Reference images

Upload a reference image and pass its URL in `RealtimeContext`. Here,
`referenceFile` is a browser `File` selected by your app:

```javascript
const reference = await client.createStorageService().uploadImage({
  data: referenceFile,
  fileName: referenceFile.name,
});

const context = new RealtimeContext({
  prompt: "视频中角色替换成参考图中角色",
  referencePath: reference.url,
});
```

Use this context when calling `startGeneration`. An existing accessible image URL
can be supplied directly without uploading it again.

<br>

## Image and video inputs

Use `createLocalImageStream` instead of `createLocalCameraStream` to use a local
image as the video input. It accepts a browser-decodable `File` or `Blob`, preserves
the complete image, and continuously sends the same frame without audio.
No image upload or camera permission is required.

```javascript
const localStream = await realtime.createLocalImageStream({
  file: imageFile, // File from an <input type="file" accept="image/*">.
  videoFormat: new RealtimeVideoFormat({ width: 1024, height: 1920, fps: 30 }),
});

const remoteStream = await realtime.startGeneration({
  localStream,
  context: new RealtimeContext({ prompt: "Make the scene come alive" }),
});
```

Bind the returned tracks to the same video views used for camera input.
TRTC, Agora, and VeRTC use the existing external-video publishing path.
`disconnect()` retains the image for reconnection; `close()` releases its resources.
Animated images are captured as a single still frame.

For a local video, replace stream creation with:

```javascript
const localStream = await realtime.createLocalVideoStream({
  file: videoFile,
  videoFormat: new RealtimeVideoFormat({ width: 1024, height: 1920, fps: 30 }),
  loop: true,
  includeAudio: true,
});
```

Use a `File` or `Blob` containing decodable video. Call from a user gesture to
unlock playback. Playback starts with generation; looping and file audio are
enabled by default. Local preview is muted, and microphone permission is not used.

<br>

## Media and generation sizes

For local images and local videos, the SDK reads the actual media dimensions,
limits the pixel area, and aligns the result to multiples of 4 without enlarging it.
The `videoFormat` width and height remain accepted for compatibility; frame rate
and encoding settings are retained. External video tracks use the same size rules;
pass their original dimensions in `createExternalVideoStream({ videoTrack, videoFormat })`.
The SDK selects the model generation canvas separately from the media size.
It sends `padding: "contain"` only when the resolved media and canvas aspect ratios
differ. Requested output dimensions follow the fixed media size and downlink quality
tier. Uplink quality changes do not change the generation canvas or media baseline.

Camera, local-image, local-video, and external-track gestures use normalized
coordinates in `[0, 1]` relative to their media, independent of encoding quality changes.

<br>

## External video and PCM input

Use `createExternalVideoStream({ source })` to bind a `RealtimeExternalVideoSource`.
The source declares its original `videoFormat` and optional `hasAudio` (default
`false`), installs capture/decoder callbacks in `start(sink)`, and removes them in
`stop()`. Your app continues to own its devices, decoder, and original frames.

```typescript
import type { RealtimeExternalFrameSink, RealtimeExternalVideoSource } from "@xmaxai/web-sdk";
import { RealtimeVideoFormat } from "@xmaxai/web-sdk";

let input: RealtimeExternalFrameSink | undefined;
const source: RealtimeExternalVideoSource = {
  videoFormat: new RealtimeVideoFormat({ width: 1280, height: 720, fps: 30 }),
  hasAudio: true,
  async start(sink) {
    input = sink;
    // Install your capture/decoder callbacks here. Do not wait for generation.
  },
  async stop() {
    input = undefined;
    // Remove callbacks here. Keep this safe to call while startup is pending.
  },
};

// Call from a user gesture when supplying audio.
const local = await realtime.createExternalVideoStream({ source });
// Bind local.videoTrack to an SDK video view, then connect/startGeneration as usual.

function onCapturedVideo(frame: VideoFrame) {
  try { input?.pushVideo(frame); } finally { frame.close(); }
}
function onDecodedAudio(frame: AudioData) {
  try { input?.pushAudio(frame); } finally { frame.close(); }
}

// Once disconnected, detach the source and invalidate its old sink:
await realtime.disconnect();
await realtime.stopExternalVideoStream();
```

- Both timestamps are nonnegative microseconds on one monotonic source timeline.
  Keep timestamps increasing across loops and seeks; pace submission in real time.
  Repeated/backward video times and overlapping audio buffers are ignored.
- Submit video at the declared source dimensions, with rotation/mirroring already
  applied. The SDK scales to the resolved media size and provides local preview;
  camera resolution buckets do not apply. `sink.videoFormat` exposes this fixed size.
- Audio must be decoded PCM (`AudioData`), 8–192 kHz, 1–8 channels, at most one second
  per packet. Its format must remain fixed during a binding. Samples are copied,
  downmixed to mono and resampled through AudioWorklet (some browsers expose a
  two-channel track containing identical mono samples). Browser audio tracks are
  continuous, so gaps become silence; original PTS cannot be forwarded as native
  RTC packet timestamps. There is a shared 20 ms scheduling allowance and bounded
  queuing, not an exact replica of native RTC frame submission.
- Audio is uploaded only after RTC publication. `disconnect()` flushes queued
  audio but preserves the source/video preview; reconnection does not replay old
  audio. No microphone permission is requested and no input audio is played locally.
- `source.start()` must return when callbacks are installed, without waiting for a
  first frame or generation. Startup is limited to 10 seconds; `stop()` is called
  after startup failure/cancellation too. `stopExternalVideoStream()` and `close()`
  invalidate the sink, clear preview, and release SDK-created tracks. A source error
  reported via `sink.reportError(error)` ends the connection and local stream.
- Video input requires `VideoFrame` and Canvas capture. Audio additionally requires
  a secure context, AudioWorklet and an unlocked AudioContext. This path uses the
  existing TRTC, Agora and VeRTC external-track adapters; it does not upload files.

The existing `createExternalVideoStream({ videoTrack, videoFormat })` form remains
video-only and keeps its clone/ownership behavior. Do not combine it with `source`.

<br>

## Generated audio and video frames

The SDK does not record or package files. Your app decides when to observe media,
encode it, and stop recording. Register from a user gesture (for example a button
click) and await setup before expecting callbacks:

```javascript
await realtime.setRemoteMediaFrameListener(packet => {
  if (packet.content.type === "video") {
    const { frame } = packet.content.frame;
    try {
      // Submit synchronously to your encoder, or transfer ownership to your worker.
      // Both tracks use packet.presentationTimeStamp in microseconds.
      console.log(packet.streamID, packet.presentationTimeStamp, frame.displayWidth);
    } finally {
      frame.close(); // If retained/transferred asynchronously, release it there instead.
    }
  } else {
    const { data, sampleRate, channels, samplesPerChannel } = packet.content.frame;
    // Owned S16LE, interleaved PCM; data remains valid after this callback.
    console.log(data, sampleRate, channels, samplesPerChannel);
  }
});

// Stop observing at any time, without stopping generation or changing playback:
await realtime.setRemoteMediaFrameListener(undefined);
```

- Video is copied from the original remote track, excluding
  mirroring, cropping, interaction effects, and UI overlays.
- Audio is taken before playback-volume processing. Muting playback does not mute
  observed PCM on supported platforms. No synthetic silence is added when no audio
  track exists; audio published later is observed after subscription.
- Audio and video share a receiver presentation clock, not sender/source-file
  timecode. Use one recording origin for both tracks; do not pair packets by
  callback arrival time. Audio time advances by sample count between discontinuities.
- A new result binding has a new opaque streamID. The first packet of each track,
  format/clock changes, and dropped output are marked isDiscontinuous. Your app
  decides whether to retain gaps, segment, or trim both tracks. The SDK neither
  compresses timestamps nor imposes a recording-duration limit.
- Callbacks run on the main thread in delivery order, not cross-track PTS order.
  Keep them lightweight and move encoding to a worker. Pending SDK delivery is
  bounded to 256 packets and 32 MiB; already-delivered video frames belong to your
  app and must be closed. Removing/replacing the listener discards queued output.
- Requires a secure context, VideoFrame, requestVideoFrameCallback, and AudioWorklet.
  Registration rejects when setup is unavailable, cancelled, or blocked by audio
  autoplay policy. TRTC on mobile Safari currently cannot provide PCM independently
  of playback and is rejected without interrupting generation.
- Browser frame callbacks can skip frames, especially under main-thread load or
  in background tabs. This is not a lossless dump of every decoded frame.
- Without a listener, no observation video, audio graph, or output queue is started.
  Disconnect preserves the listener for a later connection; close removes it and
  releases the audio context. Re-register before reusing a closed manager.

<br>

## React

Use the framework-independent `XmaxRealtimeVideoView` for a single track, or
`XmaxRealtimeDualVideoView` for local and generated video. Their React counterparts
are `XmaxRealtimeVideo` and `XmaxRealtimeDualVideo`.

Keep tracks in React state so the component updates when streams are ready. For
example, inside your component:

```tsx
const [localTrack, setLocalTrack] = useState<RealtimeVideoTrack>();
const [remoteTrack, setRemoteTrack] = useState<RealtimeVideoTrack>();

async function start() {
  const local = await realtime.createLocalCameraStream({
    preset: RealtimeCameraPreset.resolution1080x1920,
    position: CameraPosition.front,
    useMicrophone: false,
  });
  setLocalTrack(local.videoTrack);
  const remote = await realtime.startGeneration({ localStream: local, context });
  setRemoteTrack(remote.videoTrack);
}

return <>
  <button onClick={start}>Start</button>
  <XmaxRealtimeDualVideo
    localTrack={localTrack}
    remoteTrack={remoteTrack}
    style={{ width: "100%", height: "70vh" }}
  />
</>;
```

Import `useState` from React, `XmaxRealtimeDualVideo` from `@xmaxai/web-sdk/react`,
and the SDK types and configuration values from `@xmaxai/web-sdk`. The example
assumes `realtime` and `context` are retained for the component's lifetime. Handle
errors in your app and call `close()` when leaving the generation screen.

`remoteVideoFadeInDuration` is measured in seconds and defaults to `0.3`. Zero,
negative, or nonfinite values disable the animation without skipping render warmup.
Changes apply to the next fade-in.

<br>

## Touch interaction

`XmaxRealtimeVideo` and `XmaxRealtimeDualVideo` support dragging on the remote output with a
mouse, pen, or multiple touch points. Interaction becomes available after generation
starts. The SDK maps the displayed coordinates to the model input and sends the
trajectory automatically; local previews do not send interaction events.

Set `isInteractionEnabled={false}` to disable interaction without stopping playback.
The framework-independent views expose the same `isInteractionEnabled` property.

Use `trajectoryRenderer` to supply a `TrajectoryEffectRendering` implementation for
custom visuals, or leave it undefined to use the default glowing trail. A renderer
only controls visuals, not sampling or signaling; use a separate instance per view
and release its animation resources in `reset()`.

`DefaultTrajectoryEffectRenderer` is also exported for shared interaction overlays
that need the exact SDK visuals. Mount its `element`, feed viewport CSS-pixel
`TrajectoryPoint` values through `renderBegan` / `renderMoved` / `renderEnded`,
and call `reset()` before removing it. This visual renderer does not send tracks.

The generated response to dragging depends on the model and generation prompt.

<br>

## Statistics and quality monitoring

Register `setUplinkVideoStatisticsListener` and `setDownlinkVideoStatisticsListener`
to observe video statistics. Use `setNetworkQualityListener` for connection quality
and `setTimingListener` for startup-stage durations.

Unavailable video metrics are `undefined`, not inferred from another stage's frame
rate. Both video statistics types use `packetLossPercent` (0–100) and `bitrateKbps`;
downlink `renderFrameRate` is reported by the RTC provider. Network quality ranges from
`unknown` to `excellent`, `good`, `poor`, `bad`, `veryBad`, and `down`.
RTT and playback-buffer diagnostics remain in RTC performance logs rather than
these public statistics structures. Listeners receive `undefined` when their
current snapshot is cleared.

Automatic uplink/downlink quality adaptation is enabled by default on supported RTC
providers. Set `isAdaptiveQualityEnabled: false` in `RealtimeConfiguration` to start
each connection at L1 without reading or writing quality history. Manual changes
through `setUplinkQualityLevel` and `setDownlinkQualityLevel` remain available,
and statistics listeners continue to receive updates.

<br>

## Lifecycle and errors

Handle errors thrown by async calls with `try/catch`. Failures that end the realtime
workflow are also available through `state.reason` after cleanup completes.

For camera input, bind the returned video track to a preview view. The SDK enters
`ready` after it has received a valid frame and the preview view is bound; observe
this through `setStateListener`.

`startGeneration()` returns a remote stream for mounting; it does not wait for
the video view to finish preparing. Bind its track to an SDK video component.
The state remains `RealtimeConnectionState.starting` until the first frame and
render warmup are complete, then becomes
`RealtimeConnectionState.generating` as the video fades in. Use this state to
dismiss your loading UI. Without an SDK video view, the state stays `starting`.

At generation start, the SDK sends `params.mirror: true` for the front camera
and `false` for the rear camera and local files. The backend
mirrors the input; generated results are not automatically mirrored in the
browser. The front-camera local preview remains mirrored independently.
This flag is sent only with `start`: switching cameras during an active generation
does not update it. Disconnect and start generation again to apply the new camera
position to the backend.

<br>

## Recording in XLab

During generation, click **录制** to record the remote output and click it again to
stop. A preview/save dialog opens when encoding finishes. The example uses
`setRemoteMediaFrameListener` and encodes in a Worker; the recorder and its
`mediabunny` dependency belong to XLab, not the SDK. It prefers MP4 (H.264/AAC),
with WebM (VP8/Opus) as a fallback. Playback muting does not mute recorded audio on
supported platforms. Recordings exclude UI overlays, and retain
the receiver timeline rather than trimming network stalls. Ending a session also
finishes the current recording. To bound memory, XLab automatically finishes near
128 MiB of encoded media; overloaded encoders report an error instead of queuing
unbounded raw frames. Closing/reloading the page discards unsaved recordings.
Native save-location selection depends on browser support; otherwise the save
button starts a regular download.
