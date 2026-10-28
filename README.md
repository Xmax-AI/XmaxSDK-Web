<p align="center">
  <img src="./materials/images/brand/xmax-sdk.png" alt="XmaxSDK — Realtime Interactive Video Generation" width="880">
</p>

<p align="center">
  <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript"><img src="https://img.shields.io/badge/JavaScript-ES2020-F7DF1E" alt="JavaScript ES2020"></a>
  <a href="https://platform.xmaxai.com/"><img src="https://img.shields.io/badge/Realtime-AI-FF9500" alt="Realtime AI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-4C9A2A" alt="MIT License"></a>
</p>

We introduce XmaxSDK, a JavaScript SDK designed for real-time interactive video generation via Xmax models. XmaxSDK implements an end-to-end pipeline covering media acquisition, video streaming, frame-by-frame generation, and on-device rendering, enabling developers to seamlessly integrate low-latency, high-fidelity video transformations into creative applications at a much lower cost than alternative solutions.

<p align="center"><img src="./materials/images/xlab/generation-demo.gif" alt="X-Lab realtime generation demo" width="33%" /><img src="./materials/images/xlab/index-demo.gif" alt="X-Lab index demo" width="33%" /><img src="./materials/images/xlab/storage-demo.gif" alt="X-Lab storage demo" width="33%" /></p>

<br>

## What you can build with XmaxSDK

<table>
  <tr>
    <th width="24%" align="left">Realtime Use Case</th>
    <th width="60%" align="left">Description</th>
    <th width="16%" align="center">Demo</th>
  </tr>
  <tr>
    <td rowspan="2" width="24%" valign="middle">
      <strong>Character Swapping</strong>
    </td>
    <td width="60%" valign="middle">
      Replace anyone in your live feed with a designated avatar in real-time.
    </td>
    <td rowspan="2" width="16%" align="center" valign="middle">
      <a href="./materials/videos/use-cases/character-swapping.mp4">
        <img src="./materials/images/use-cases/character-swapping-poster.png" alt="Play the Character Swapping demo" width="120">
        <br>
        <sub>▶ Play demo</sub>
      </a>
    </td>
  </tr>
  <tr>
    <td width="60%" valign="middle">
      <strong>Prompt:</strong> <code>视频中角色替换成参考图中角色</code>
      <br><br>
      <strong>Reference image:</strong> Select a clear image of the desired character with a clean background.
    </td>
  </tr>
  <tr>
    <td rowspan="2" width="24%" valign="middle">
      <strong>Virtual Try-On</strong>
    </td>
    <td width="60%" valign="middle">
      Seamlessly change outfits, preserving exact body shape, natural motion, and an
      authentic fit.
    </td>
    <td rowspan="2" width="16%" align="center" valign="middle">
      <a href="./materials/videos/use-cases/virtual-try-on.mp4">
        <img src="./materials/images/use-cases/virtual-try-on-poster.png" alt="Play the Virtual Try-On demo" width="120">
        <br>
        <sub>▶ Play demo</sub>
      </a>
    </td>
  </tr>
  <tr>
    <td width="60%" valign="middle">
      <strong>Prompt:</strong> <code>视频中人物衣服替换成参考图中衣服</code>
      <br><br>
      <strong>Reference image:</strong> Select a clear image of the target outfit with a clean background.
    </td>
  </tr>
  <tr>
    <td rowspan="2" width="24%" valign="middle">
      <strong>Video Restyling</strong>
    </td>
    <td width="60%" valign="middle">
      Reimagine your world in any style with an immersive visual experience.
    </td>
    <td rowspan="2" width="16%" align="center" valign="middle">
      <a href="./materials/videos/use-cases/video-restyling.mp4">
        <img src="./materials/images/use-cases/video-restyling-poster.png" alt="Play the Video Restyling demo" width="120">
        <br>
        <sub>▶ Play demo</sub>
      </a>
    </td>
  </tr>
  <tr>
    <td width="60%" valign="middle">
      <strong>Prompt:</strong> <code>视频风格变为参考图指定的风格</code>
      <br><br>
      <strong>Reference image:</strong> Select an image that captures the artistic style you want to apply.
    </td>
  </tr>
  <tr>
    <td rowspan="2" width="24%" valign="middle">
      <strong>AI Companions</strong>
    </td>
    <td width="60%" valign="middle">
      Summon virtual characters into your live camera feed and interact with them
      through gestures.
    </td>
    <td rowspan="2" width="16%" align="center" valign="middle">
      <a href="./materials/videos/use-cases/ai-companions.mp4">
        <img src="./materials/images/use-cases/ai-companions-poster.png" alt="Play the AI Companions demo" width="120">
        <br>
        <sub>▶ Play demo</sub>
      </a>
    </td>
  </tr>
  <tr>
    <td width="60%" valign="middle">
      <strong>Prompt:</strong> <code>指定角色在场景中互动</code>
      <br><br>
      <strong>Reference image:</strong> Select a clear image of the virtual character you want to summon with a clean background.
    </td>
  </tr>
  <tr>
    <td rowspan="2" width="24%" valign="middle">
      <strong>Live Photo</strong>
    </td>
    <td width="60%" valign="middle">
      Animate and control characters in your images simply by drawing motion
      trajectories.
    </td>
    <td rowspan="2" width="16%" align="center" valign="middle">
      <a href="./materials/videos/use-cases/live-photo.mp4">
        <img src="./materials/images/use-cases/live-photo-poster.png" alt="Play the Live Photo demo" width="120">
        <br>
        <sub>▶ Play demo</sub>
      </a>
    </td>
  </tr>
  <tr>
    <td width="60%" valign="middle">
      <strong>Prompt:</strong> <code>让画面自然动起来</code>
      <br><br>
      <strong>Reference image:</strong> Use the input image as the reference
    </td>
  </tr>
</table>

<br>

## Why XmaxSDK?

<table>
  <thead>
    <tr>
      <th height="104" align="center" valign="middle">
        <img src="./materials/images/why/low-latency.svg" alt="Low latency" width="36" height="36"><br>Low latency
      </th>
      <th height="104" align="center" valign="middle">
        <img src="./materials/images/why/low-cost.svg" alt="Cost efficiency" width="36" height="36"><br>Cost efficiency
      </th>
      <th height="104" align="center" valign="middle">
        <img src="./materials/images/why/high-fidelity.svg" alt="High fidelity" width="36" height="36"><br>High fidelity
      </th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>End-to-end latency is measured in <img src="./materials/images/why/latency-highlight.svg" alt="hundreds of milliseconds" width="192" height="20" align="absmiddle">, ensuring that updates to generation conditions and interaction controls are reflected instantly.</td>
      <td>Run on a <img src="./materials/images/why/gpu-highlight.svg" alt="single RTX 5090" width="126" height="20" align="absmiddle">, reducing inference costs by orders of magnitude versus datacenter GPUs like H100.</td>
      <td>Our models support real-time generation at up to <img src="./materials/images/why/resolution-highlight.svg" alt="1080p" width="48" height="20" align="absmiddle">, delivering production-ready, high-quality video output.</td>
    </tr>
  </tbody>
</table>

<br>

## Prerequisites

- A WebRTC-enabled browser running on HTTPS or localhost
- Node.js 18 or later, with pnpm or npm for development
- An Xmax API key

> [!WARNING]
> Never commit your Xmax API key to version control or embed a long-lived key in
> client-side bundles. Use short-lived temporary keys issued by your backend
> through the Xmax API. For step-by-step
> instructions, see [Authentication](https://platform.xmaxai.com/docs/authentication).

<br>

## Installation

```bash
npm install @xmaxai/web-sdk
```

The package includes optional React components at `@xmaxai/web-sdk/react`.
React applications use their own React installation; non-React applications do not need React.

<br>

## Quick Start

### Configure permissions

Serve your application over HTTPS or localhost and allow camera access. For an
embedded application, configure the iframe permissions:

```html
<iframe src="https://your-app.example" allow="camera; microphone; autoplay"></iframe>
```

<br>

### Generate and display video

Add a container with an explicit size:

```html
<div id="video-container" style="width: 100%; height: 70vh;"></div>
```

Run the following in an async function called from a user action, such as clicking
a Start button:

```javascript
import {
  CameraPosition,
  RealtimeCameraPreset,
  RealtimeConfiguration,
  RealtimeContext,
  RealtimeModel,
  VideoContentMode,
  XmaxClient,
  XmaxConfiguration,
  XmaxRealtimeDualVideoView,
} from "@xmaxai/web-sdk";

const client = new XmaxClient(
  new XmaxConfiguration({ apiKey: "YOUR_TEMPORARY_XMAX_API_KEY" })
);

const realtime = client.createRealtimeManager(
  new RealtimeConfiguration({ model: RealtimeModel.x2_1 })
);

const localStream = await realtime.createLocalCameraStream({
  preset: RealtimeCameraPreset.resolution1080x1920,
  position: CameraPosition.front,
  useMicrophone: false,
});

const videoView = new XmaxRealtimeDualVideoView({
  localTrack: localStream.videoTrack,
  videoContentMode: VideoContentMode.fill,
});

videoView.element.style.width = "100%";
videoView.element.style.height = "100%";
const container = document.getElementById("video-container");
if (!container) {
  throw new Error("Missing #video-container element");
}
videoView.attach(container);

const remoteStream = await realtime.startGeneration({
  localStream,
  context: new RealtimeContext({
    prompt: "视频中角色替换成参考图中角色",
    referencePath: "https://cdn.22duck.cn/images/source/charx/chatx_image1.jpg",
  }),
});

videoView.remoteTrack = remoteStream.videoTrack;
```

The view displays the local preview until generated video is ready, with dragging
and touch interaction enabled by default. Set `remoteVideoFadeInDuration` to
customize the fade-in duration in seconds; the default is `0.3`.

<br>

### Using React

Use `XmaxRealtimeDualVideo` from the optional React entry point. Store the local
and remote tracks in component state and update them as streams become available:

```jsx
import { XmaxRealtimeDualVideo } from "@xmaxai/web-sdk/react";
import { VideoContentMode } from "@xmaxai/web-sdk";

<XmaxRealtimeDualVideo
  localTrack={localTrack}
  remoteTrack={remoteTrack}
  videoContentMode={VideoContentMode.fill}
  style={{ width: "100%", height: "100%" }}
/>
```

See the [React guide](./materials/usage.md#react) for a state-binding example.

<br>

### Listen for events

Register the listeners you need after creating `realtime`, before starting media
or generation:

| Listener | Purpose |
| --- | --- |
| `setStateListener` | Observe realtime states and termination reasons. |
| `setRemoteMediaFrameListener` | Receive generated audio and video frames for recording or processing. |
| `setNetworkQualityListener` | Monitor uplink and downlink network quality. |
| `setTimingListener` | Observe startup-stage durations. |

For example, monitor state changes and errors:

```javascript
await realtime.setStateListener((state) => {
  console.log("State:", state.connectionState);
  if (state.reason?.kind === "failure") {
    console.error("Error:", state.reason.error.code, state.reason.error.message);
  }
});
```

Handle async API failures with `try/catch`. Failures that end the workflow are also
reported through `state.reason` after cleanup. Bind the local track to an SDK video
view to reach `ready`; bind the returned remote track to reach `generating` after
the first frame and render warmup. Use `generating` to dismiss your loading UI.

<br>

### Resource Cleanup

- **`disconnect()` — Stop Remote Generation**

  Ends the remote session while keeping the local camera stream
  and preview active. Use this when ending the online session but staying on the
  current screen. You can start a new session later using the same local stream:

  ```javascript
  await realtime.disconnect();
  ```

- **`close()` — Full Teardown & Release**

  Ends the remote session, stops local media capture, and releases all engine
  resources. Use this when leaving or dismissing the generation screen:

  ```javascript
  await realtime.close();
  ```

> **Note:** These methods are alternatives, not sequential steps. When exiting a
> screen, call `close()` directly—there is no need to call `disconnect()` first.

<br>

> [!TIP]
> For image and video inputs, encoding, reference images, interaction, and media
> callbacks, see the [usage guide](./materials/usage.md).

<br>

## Example Project

A complete React application is available in
[`examples/xlab-react`](./examples/xlab-react). It demonstrates camera, image and
video inputs, reference images, touch interaction, statistics, and recording.

<br>

## Dependencies

- <ins><strong>Tencent Cloud TRTC SDK for Web</strong></ins> enables low-latency, real-time audio and video communication.
- <ins><strong>Agora RTC SDK for Web</strong></ins> provides an alternative RTC transport for the Agora model.
- <ins><strong>Volcengine VeRTC SDK for Web</strong></ins> enables real-time audio and video communication.
- <ins><strong>Tencent Cloud COS SDK</strong></ins> handles media upload and download via object storage.

<br>

## Contact us

For bug reports and feature requests, please open a
[GitHub Issue](https://github.com/Xmax-AI/XmaxSDK-Web/issues). For integration
assistance and technical support, contact us at [sdk@xmax.ai](mailto:sdk@xmax.ai).

<br>

## License

XmaxSDK Web is available under the terms of the [MIT License](./LICENSE).
Third-party dependencies retain their respective licenses.
