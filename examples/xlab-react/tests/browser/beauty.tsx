import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { RealtimeVideoTrack, type VideoBeautyOptions } from "@xmaxai/web-sdk";
import { XmaxRealtimeVideo } from "@xmaxai/web-sdk/react";
import { ResultBeautyControl } from "../../src/ResultBeautyControl";
import "../../src/styles.css";

/** Exercises result-only processing without camera access, credentials, or an RTC session. */
function BeautyCheck() {
  const [enabled, setEnabled] = useState(false);
  const [beautySettings, setBeautySettings] = useState<Required<VideoBeautyOptions>>({
    smoothness: 0.3,
    lightening: 0.2,
    sharpness: 0.2,
    redness: 0.1,
  });
  const [resolution, setResolution] = useState("640x360");
  const [quality, setQuality] = useState("");
  const [track, setTrack] = useState<RealtimeVideoTrack>();
  const [status, setStatus] = useState("original");
  const [error, setError] = useState("");
  const result = useRef<HTMLDivElement>(null);
  const original = useRef<HTMLVideoElement>(null);
  const options = useMemo(() => enabled ? beautySettings : undefined, [enabled, beautySettings]);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const [width, height] = resolution.split("x").map(Number);
    canvas.width = width!;
    canvas.height = height!;
    const context = canvas.getContext("2d")!;
    let n = 0;
    const draw = () => {
      const image = context.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < image.data.length; i += 4) {
        const noise = ((i * 13 + n * 7) % 35) - 17;
        image.data[i] = 185 + noise;
        image.data[i + 1] = 135 + noise;
        image.data[i + 2] = 110 + noise;
        image.data[i + 3] = 255;
        if ((i / 4) % 157 === 0) {
          image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
        }
      }
      context.putImageData(image, 0, 0);
      context.fillStyle = "#252525";
      context.fillRect(180 + Math.sin(n / 12) * 20, 100, 40, 20);
      context.fillRect(410 + Math.sin(n / 12) * 20, 100, 40, 20);
      context.fillRect(270, 240, 100, 10);
      context.fillStyle = "#e02020";
      context.fillRect(0, 0, 80, 40);
      n++;
    };
    draw();
    const source = canvas.captureStream(30);
    original.current!.srcObject = source;
    const value = new RealtimeVideoTrack({ id: "synthetic-result" });
    value.mediaStreamTrack = source.getVideoTracks()[0];
    setTrack(value);
    const drawTimer = setInterval(draw, 33);
    const statusTimer = setInterval(() => {
      const output = result.current?.querySelector("video");
      const displayed = (output?.srcObject as MediaStream | null)?.getVideoTracks()[0];
      setStatus(displayed && displayed !== source.getVideoTracks()[0] ? "processed" : "original");
      document.body.dataset.sourceState = source.getVideoTracks()[0]?.readyState;
      document.body.dataset.outputState = displayed?.readyState;
      const sourceFrames = original.current?.getVideoPlaybackQuality().totalVideoFrames;
      const outputFrames = output?.getVideoPlaybackQuality().totalVideoFrames;
      document.body.dataset.sourceFrames = String(sourceFrames);
      document.body.dataset.outputFrames = String(outputFrames);
    }, 100);
    return () => {
      clearInterval(drawTimer);
      clearInterval(statusTimer);
      source.getTracks().forEach(mediaTrack => mediaTrack.stop());
    };
  }, [resolution]);

  function measureQuality() {
    const measure = (video: HTMLVideoElement) => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(video, 0, 0);
      const pixels = context.getImageData(120, 0, 256, 64).data;
      let error = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        error += Math.abs(pixels[i]! - 185) + Math.abs(pixels[i + 1]! - 135) + Math.abs(pixels[i + 2]! - 110);
      }
      const marker = context.getImageData(10, 10, 1, 1).data;
      return { error: error / (pixels.length / 4 * 3), upright: marker[0]! > marker[1]! + 100 };
    };
    const input = measure(original.current!);
    const output = measure(result.current!.querySelector("video")!);
    setQuality(`Source error: ${input.error.toFixed(2)}; result error: ${output.error.toFixed(2)}; upright: ${output.upright}`);
  }

  return <main style={{ padding: 32 }}>
    <h1>Generated-result processing check</h1>
    <select aria-label="Test resolution" value={resolution} onChange={event => setResolution(event.target.value)}>
      <option value="640x360">640×360</option>
      <option value="1920x1024">1920×1024</option>
      <option value="1024x1920">1024×1920</option>
    </select>
    <button onClick={measureQuality}>Measure quality</button>
    <p id="quality">{quality}</p>
    <div style={{ display: "flex", justifyContent: "flex-end", width: 976, alignItems: "center", gap: 16, margin: "16px 0" }}>
      <ResultBeautyControl enabled={enabled} options={beautySettings} onEnabledChange={setEnabled} onOptionsChange={setBeautySettings} />
      <span id="status">{status}</span>
      <span id="error">{error}</span>
    </div>
    <div style={{ display: "flex", gap: 16 }}>
      <div><p>Original received video</p><video ref={original} autoPlay muted playsInline style={{ width: 480 }} /></div>
      <div ref={result}><p>Result view</p><XmaxRealtimeVideo track={track} beautyOptions={options}
        onBeautyError={failure => { setError(failure.message); setEnabled(false); }} style={{ width: 480, height: 270 }} /></div>
    </div>
  </main>;
}

const root = createRoot(document.getElementById("root")!);
root.render(<BeautyCheck />);
import.meta.hot?.dispose(() => root.unmount());
