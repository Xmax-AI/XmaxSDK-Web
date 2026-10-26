//
//  RemoteAudioWorklet.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 独立音频线程将输入复制成约 20 ms 的 S16LE PCM 包，不输出可听声音。
 * 时间使用音频上下文的采样时钟，不使用主线程收到消息的时间。
 */
export const REMOTE_AUDIO_WORKLET = `
class XmaxRemoteAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = 0;
    this.filled = 0;
    this.startFrame = 0;
    this.nextFrame = undefined;
    this.discontinuous = true;
    this.packetSamples = Math.max(1, Math.round(sampleRate * 0.02));
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length || !input[0].length) {
      this.filled = 0;
      this.nextFrame = undefined;
      this.discontinuous = true;
      return true;
    }
    const channels = Math.min(2, input.length);
    if (channels !== this.channels || this.nextFrame !== currentFrame) {
      this.channels = channels;
      this.filled = 0;
      this.bytes = new ArrayBuffer(this.packetSamples * channels * 2);
      this.data = new DataView(this.bytes);
      this.discontinuous = true;
    }
    for (let i = 0; i < input[0].length; i++) {
      if (this.filled === 0) this.startFrame = currentFrame + i;
      for (let channel = 0; channel < channels; channel++) {
        const value = Math.max(-1, Math.min(1, input[channel][i] || 0));
        this.data.setInt16((this.filled * channels + channel) * 2,
          Math.round(value < 0 ? value * 32768 : value * 32767), true);
      }
      if (++this.filled === this.packetSamples) {
        this.port.postMessage({ data: this.bytes, sampleRate, channels,
          samplesPerChannel: this.packetSamples, frameIndex: this.startFrame,
          discontinuous: this.discontinuous }, [this.bytes]);
        this.bytes = new ArrayBuffer(this.packetSamples * channels * 2);
        this.data = new DataView(this.bytes);
        this.filled = 0;
        this.discontinuous = false;
      }
    }
    this.nextFrame = currentFrame + input[0].length;
    return true;
  }
}
registerProcessor("xmax-remote-audio", XmaxRemoteAudioProcessor);
`;
