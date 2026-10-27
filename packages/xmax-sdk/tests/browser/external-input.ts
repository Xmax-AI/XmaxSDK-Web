import { ExternalFrameSourceController } from "../../src/Media/External/ExternalFrameSourceController";
import { RemoteMediaFrameController } from "../../src/Render/Video/RemoteMediaFrameController";
import type { RealtimeExternalFrameSink, RealtimeExternalVideoSource } from "../../src/Media/External/RealtimeExternalVideoSource";
import { RealtimeVideoFormat } from "../../src/Service/Realtime/RealtimeVideoFormat";
import { MediaService } from "../../src/Service/Media/MediaService";
import type { RealtimeExternalAudioFrame } from "../../src/Foundation/Media/Audio/RealtimeExternalAudioFrame";

const NativeAudioData = (window as unknown as { AudioData: new (init: {
  data: Int16Array; format: "s16"; sampleRate: number; numberOfChannels: number; numberOfFrames: number; timestamp: number;
}) => RealtimeExternalAudioFrame & { close(): void } }).AudioData;

const button = document.getElementById("run") as HTMLButtonElement;
const result = document.getElementById("result")!;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

class Source implements RealtimeExternalVideoSource {
  readonly videoFormat = new RealtimeVideoFormat({ width: 640, height: 360, fps: 30 });
  readonly hasAudio = true;
  sink?: RealtimeExternalFrameSink;
  stops = 0;
  ownershipPreserved = true;
  videosSubmitted = 0;
  private videoTimer?: ReturnType<typeof setInterval>;
  private audioTimer?: ReturnType<typeof setInterval>;

  async start(sink: RealtimeExternalFrameSink): Promise<void> {
    this.sink = sink;
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext("2d")!;
    let videoIndex = 0;
    this.videoTimer = setInterval(() => {
      context.fillStyle = `hsl(${videoIndex++ % 360}, 65%, 40%)`;
      context.fillRect(0, 0, 640, 360);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) });
      try { sink.pushVideo(frame); this.videosSubmitted++; this.ownershipPreserved &&= frame.displayWidth === 640; }
      finally { frame.close(); }
    }, 1000 / 30);
    const start = performance.now() * 1000;
    let samples = 0;
    this.audioTimer = setInterval(() => {
      const data = new Int16Array(882 * 2);
      for (let i = 0; i < 882; i++) {
        const value = Math.round(Math.sin((samples + i) / 44100 * Math.PI * 2 * 440) * 16000);
        data[2 * i] = value; data[2 * i + 1] = value / 2;
      }
      const frame = new NativeAudioData({ data, format: "s16", sampleRate: 44100, numberOfChannels: 2,
        numberOfFrames: 882, timestamp: Math.round(start + samples / 44100 * 1_000_000) });
      samples += 882;
      try { sink.pushAudio(frame); this.ownershipPreserved &&= frame.format === "s16"; }
      finally { frame.close(); }
    }, 20);
  }

  async stop(): Promise<void> {
    this.stops++;
    clearInterval(this.videoTimer); clearInterval(this.audioTimer);
  }
}

button.onclick = async () => {
  button.disabled = true;
  result.textContent = "Checking video, PCM, publish, disconnect and reconnect…";
  const errors: string[] = [];
  const input = new ExternalFrameSourceController(error => errors.push(error.message));
  const output = new RemoteMediaFrameController();
  const source = new Source();
  let phase = "off", video = 0, audio = 0, before = false, during = false, after = false, resumed = false;
  let outputRate = 0, outputChannels = 0;
  let monoSamples = true;
  try {
    const observing = output.setListener(packet => {
      if (packet.content.type === "video") { video++; packet.content.frame.frame.close(); return; }
      audio++;
      const frame = packet.content.frame;
      outputRate = frame.sampleRate; outputChannels = frame.channels;
      const pcm = new DataView(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      if (frame.channels === 2) {
        for (let offset = 0; offset < pcm.byteLength; offset += 4) {
          monoSamples &&= pcm.getInt16(offset, true) === pcm.getInt16(offset + 2, true);
        }
      }
      let nonzero = false;
      for (let offset = 0; offset < pcm.byteLength; offset += 2) nonzero ||= Math.abs(pcm.getInt16(offset, true)) > 100;
      if (phase === "off") before ||= nonzero;
      if (phase === "on") during ||= nonzero;
      if (phase === "disconnected") after ||= nonzero;
      if (phase === "reconnected") resumed ||= nonzero;
    });
    const creating = input.create(source, new MediaService(), new AbortController().signal);
    const [, stream] = await Promise.all([observing, creating]);
    output.setSource({ bindingID: "synthetic", userID: "source", videoTrack: stream.videoTrack!.mediaStreamTrack!, audioTrack: input.audioTrack });
    await delay(250);
    phase = "on"; input.setAudioPublished(true);
    await delay(900);
    phase = "draining"; input.setAudioPublished(false);
    await delay(100);
    phase = "disconnected";
    await delay(200);
    phase = "reconnected"; input.setAudioPublished(true);
    await delay(600);
    const sink = source.sink!;
    await input.stop();
    result.textContent = JSON.stringify({ pass: !errors.length && video > 10 && audio > 20 && !before && during && !after && resumed &&
      source.ownershipPreserved && source.stops === 1 && !sink.isRequestingFrames && monoSamples && outputRate === 48000,
      video, videosSubmitted: source.videosSubmitted, audio, inputRate: 44100, inputChannels: 2, outputRate, outputChannels, monoSamples,
      silentBeforePublish: !before, soundWhenPublished: during, silentAfterDisconnect: !after, soundAfterReconnect: resumed,
      ownershipPreserved: source.ownershipPreserved, stopCount: source.stops, staleSinkRejected: !sink.isRequestingFrames, errors }, null, 2);
  } catch (error) {
    result.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await input.stop(); await output.setListener(undefined); button.disabled = false;
  }
};
