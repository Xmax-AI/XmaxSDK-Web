import {
  AudioSample, AudioSampleSource, BufferTarget, canEncodeAudio, canEncodeVideo,
  Mp4OutputFormat, Output, VideoSample, VideoSampleSource, WebMOutputFormat,
} from "mediabunny";
import type { RealtimeMediaFrame } from "@xmaxai/web-sdk";
import type { RecordingRequest, RecordingResponse } from "./recordingMessages";
import { RecordingVideoFrameConverter } from "./RecordingVideoFrameConverter";

const worker = self as unknown as {
  onmessage: (event: MessageEvent<RecordingRequest>) => void;
  postMessage: (message: RecordingResponse) => void;
};
let output: Output<Mp4OutputFormat | WebMOutputFormat, BufferTarget> | undefined;
let video: VideoSampleSource;
let audio: AudioSampleSource;
let extension: "mp4" | "webm" = "mp4";
let origin: number | undefined;
let videoCount = 0;
let stopped = false;
let failed = false;
let encodedBytes = 0;
let limitReached = false;
let videoQueue = Promise.resolve();
let audioQueue = Promise.resolve();
const converter = new RecordingVideoFrameConverter();

// 编码后的文件也驻留内存，达到上限时通知应用正常收尾，而不是无限增长。
function trackSize(packet: { byteLength: number }) {
  encodedBytes += packet.byteLength;
  if (encodedBytes >= 128 * 1024 * 1024 && !limitReached) {
    limitReached = true;
    worker.postMessage({ type: "limit" });
  }
}

async function start() {
  const mp4 = await canEncodeVideo("avc", { width: 1920, height: 1080 }) && await canEncodeAudio("aac");
  if (!mp4 && !(await canEncodeVideo("vp8") && await canEncodeAudio("opus"))) {
    throw new Error("此浏览器不支持录制所需的音视频编码，请使用新版 Chrome、Edge 或 Safari");
  }
  extension = mp4 ? "mp4" : "webm";
  output = new Output({ format: mp4 ? new Mp4OutputFormat() : new WebMOutputFormat(), target: new BufferTarget() });
  video = new VideoSampleSource({ codec: mp4 ? "avc" : "vp8", bitrate: 6_000_000,
    keyFrameInterval: 2, latencyMode: "realtime", sizeChangeBehavior: "contain", onEncodedPacket: trackSize });
  audio = new AudioSampleSource({ codec: mp4 ? "aac" : "opus", bitrate: 128_000, onEncodedPacket: trackSize });
  output.addVideoTrack(video);
  output.addAudioTrack(audio);
  await output.start();
  worker.postMessage({ type: "ready" });
}

async function encode(packet: RealtimeMediaFrame) {
  if (failed) {
    if (packet.content.type === "video") packet.content.frame.frame.close();
    return;
  }
  const timestamp = (packet.presentationTimeStamp - origin!) / 1_000_000;
  if (packet.content.type === "video") {
    const frame = packet.content.frame.frame;
    let converted: VideoFrame | undefined;
    let sample: VideoSample | undefined;
    try {
      if (timestamp < 0) return;
      converted = await converter.convert(frame, Math.round(timestamp * 1_000_000), 33_333);
      sample = new VideoSample(converted);
      await video.add(sample);
      videoCount++;
    } finally {
      if (sample) sample.close(); else converted?.close();
      frame.close();
    }
  } else {
    const frame = packet.content.frame;
    // 两条轨道使用同一起点；首个音频包若跨过零点，只裁掉零点前的样本。
    const trim = Math.max(0, Math.ceil(-timestamp * frame.sampleRate));
    if (trim >= frame.samplesPerChannel) return;
    const sample = new AudioSample({ data: frame.data.subarray(trim * frame.channels * 2), format: "s16",
      sampleRate: frame.sampleRate, numberOfChannels: frame.channels,
      timestamp: timestamp + trim / frame.sampleRate });
    try {
      await audio.add(sample);
    } finally {
      sample.close();
    }
  }
}

function fail(error: unknown) {
  if (failed) return;
  failed = true;
  worker.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  void output?.cancel().catch(() => {});
}

async function stop() {
  stopped = true;
  await Promise.all([videoQueue, audioQueue]);
  if (failed) return;
  if (!videoCount) throw new Error("没有收到可录制的远端视频帧，请等画面出现后重试");
  video.close();
  audio.close();
  await output!.finalize();
  worker.postMessage({ type: "complete", extension,
    blob: new Blob([output!.target.buffer!], { type: output!.format.mimeType }) });
}

worker.onmessage = ({ data }) => {
  if (data.type === "start") {
    void start().catch(fail);
  } else if (data.type === "stop") {
    void stop().catch(fail);
  } else {
    const { packet, id } = data;
    if (stopped || failed) {
      if (packet.content.type === "video") packet.content.frame.frame.close();
      worker.postMessage({ type: "accepted", id });
      return;
    }
    origin ??= packet.presentationTimeStamp;
    const description = packet.content.type === "video"
      ? `视频 ${packet.content.frame.frame.format ?? "opaque"} ${packet.content.frame.frame.displayWidth}×${packet.content.frame.frame.displayHeight}`
      : `音频 ${packet.content.frame.sampleRate}Hz/${packet.content.frame.channels}ch`;
    const process = () => encode(packet).catch(error => fail(new Error(
      `录制编码失败（${description}）：${error instanceof Error ? error.message : String(error)}`,
    ))).finally(() => worker.postMessage({ type: "accepted", id }));
    // 两轨独立排队，避免封装器等待另一轨时阻塞另一轨进入。
    if (packet.content.type === "video") videoQueue = videoQueue.then(process);
    else audioQueue = audioQueue.then(process);
  }
};
