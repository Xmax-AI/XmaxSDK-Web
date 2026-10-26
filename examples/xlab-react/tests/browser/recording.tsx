import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BlobSource, Input, MP4, WEBM, EncodedPacketSink } from "mediabunny";
import { RemoteRecorder } from "../../src/recording/RemoteRecorder";
import { RecordingControl, type RecordingStatus } from "../../src/recording/RecordingControl";
import { RecordingSaveDialog } from "../../src/recording/RecordingSaveDialog";
import type { RecordingResult } from "../../src/recording/recordingMessages";
import { RemoteMediaFrameController } from "../../../../packages/xmax-sdk/src/Render/Video/RemoteMediaFrameController";
import "../../src/styles.css";

let recorder: RemoteRecorder | undefined;
let cleanup: (() => Promise<void>) | undefined;

/** 本机 WebRTC 回环，覆盖真正经视频解码器输出的帧，不使用任何服务或媒体设备。 */
async function decodeLocally(track: MediaStreamTrack) {
  const sender = new RTCPeerConnection({ iceServers: [] });
  const receiver = new RTCPeerConnection({ iceServers: [] });
  const close = () => { sender.close(); receiver.close(); };
  const remote = new Promise<MediaStreamTrack>((resolve, reject) => {
    const timer = setTimeout(() => { close(); reject(new Error("Local WebRTC loopback timed out")); }, 8000);
    receiver.ontrack = event => { clearTimeout(timer); resolve(event.track); };
  });
  sender.onicecandidate = event => { if (event.candidate) void receiver.addIceCandidate(event.candidate).catch(() => {}); };
  receiver.onicecandidate = event => { if (event.candidate) void sender.addIceCandidate(event.candidate).catch(() => {}); };
  const transceiver = sender.addTransceiver(track, { direction: "sendonly" });
  const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs.filter(codec => codec.mimeType === "video/H264");
  if (codecs?.length) transceiver.setCodecPreferences(codecs);
  try {
    await sender.setLocalDescription(await sender.createOffer());
    await receiver.setRemoteDescription(sender.localDescription!);
    await receiver.setLocalDescription(await receiver.createAnswer());
    await sender.setRemoteDescription(receiver.localDescription!);
    return { track: await remote, close };
  } catch (error) {
    close();
    throw error;
  }
}

function Test() {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [result, setResult] = useState<RecordingResult>();
  const [proof, setProof] = useState("Synthetic video + oscillator. No camera, microphone or backend.");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [decoded, setDecoded] = useState(true);
  const formats = React.useRef(new Set<string>());
  const sizes = React.useRef(new Set<string>());

  async function toggle() {
    try {
      if (recorder) {
        setStatus("stopping");
        const recording = await recorder.stop();
        recorder = undefined;
        await cleanup?.();
        const input = new Input({ source: new BlobSource(recording.blob), formats: [MP4, WEBM] });
        try {
          const video = (await input.getPrimaryVideoTrack())!;
          const audio = await input.getPrimaryAudioTrack();
          let videoCount = 0, audioCount = 0;
          for await (const _packet of new EncodedPacketSink(video).packets()) videoCount++;
          if (audio) for await (const _packet of new EncodedPacketSink(audio).packets()) audioCount++;
          setProof(JSON.stringify({ pass: videoCount > 10 && (includeAudio ? audioCount > 10 : audioCount === 0),
            decoded, inputFormats: [...formats.current], inputSizes: [...sizes.current],
            outputSize: `${await video.getDisplayWidth()}×${await video.getDisplayHeight()}`,
            videoCount, audioCount, duration: await input.computeDuration(), bytes: recording.blob.size,
            mime: recording.blob.type }, null, 2));
        } finally { input.dispose(); }
        setStatus("idle");
        setResult(recording);
      } else {
        setStatus("starting");
        const canvas = document.createElement("canvas");
        canvas.width = 1920; canvas.height = 1080;
        const context = canvas.getContext("2d")!;
        let count = 0;
        const draw = () => {
          context.fillStyle = `hsl(${count++ % 360}, 70%, 40%)`;
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "white"; context.font = "80px sans-serif"; context.fillText(`Frame ${count}`, 300, 560);
        };
        draw();
        const timer = setInterval(draw, 1000 / 30);
        const video = canvas.captureStream(30).getVideoTracks()[0]!;
        const audioContext = new AudioContext();
        await audioContext.resume();
        const oscillator = audioContext.createOscillator();
        const destination = audioContext.createMediaStreamDestination();
        oscillator.connect(destination); oscillator.start();
        const frames = new RemoteMediaFrameController();
        let loopback: Awaited<ReturnType<typeof decodeLocally>> | undefined;
        cleanup = async () => {
          loopback?.close();
          clearInterval(timer); video.stop(); oscillator.stop();
          destination.stream.getTracks().forEach(track => track.stop());
          await frames.setListener(undefined); await audioContext.close();
        };
        if (decoded) loopback = await decodeLocally(video);
        frames.setSource({ bindingID: "test", userID: "synthetic", videoTrack: loopback?.track ?? video,
          audioTrack: includeAudio ? destination.stream.getAudioTracks()[0] : undefined });
        formats.current.clear();
        sizes.current.clear();
        recorder = new RemoteRecorder({ setRemoteMediaFrameListener: listener => frames.setListener(listener ? packet => {
          if (packet.content.type === "video") {
            const frame = packet.content.frame.frame;
            formats.current.add(String(frame.format));
            sizes.current.add(`${frame.displayWidth}×${frame.displayHeight}`);
          }
          listener(packet);
        } : undefined) },
          error => { setProof(`${error.message}; input formats: ${[...formats.current]}`); setStatus("idle"); void cleanup?.(); recorder = undefined; },
          () => void toggle());
        await recorder.start();
        setProof("Recording; click again after a few seconds.");
        setStatus("recording");
      }
    } catch (error) {
      setProof(error instanceof Error ? error.stack ?? error.message : String(error));
      await recorder?.dispose(); recorder = undefined;
      await cleanup?.(); setStatus("idle");
    }
  }
  return <main style={{ padding: 32, maxWidth: 800, margin: "auto" }}>
    <h1>XLab recording test</h1>
    <p><label><input type="checkbox" checked={includeAudio} disabled={status !== "idle"}
      onChange={event => setIncludeAudio(event.target.checked)} /> Include audio</label></p>
    <p><label><input type="checkbox" checked={decoded} disabled={status !== "idle"}
      onChange={event => setDecoded(event.target.checked)} /> WebRTC decoded input (local H.264 loopback)</label></p>
    <RecordingControl status={status} disabled={false} onToggle={() => void toggle()} />
    <pre style={{ marginTop: 24 }}>{proof}</pre>
    {result && <RecordingSaveDialog result={result} onClose={() => setResult(undefined)} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Test />);
