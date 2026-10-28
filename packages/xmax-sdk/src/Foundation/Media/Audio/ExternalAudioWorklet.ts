//
//  ExternalAudioWorklet.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Schedules external mono PCM on the AudioContext clock, resampling linearly and filling gaps with
 * silence. The main thread bounds pending audio; the worklet releases consumed packets and reports
 * budget usage without speaker playback.
 */
export const EXTERNAL_AUDIO_WORKLET = `
class XmaxExternalAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.epoch = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "reset") {
        this.queue = [];
        this.epoch = data.epoch;
      } else if (data.epoch === this.epoch) {
        this.queue.push(data);
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    output.fill(0);
    for (let i = 0; i < output.length; i++) {
      const time = currentFrame + i;
      while (this.queue.length && time >= this.queue[0].end) {
        const packet = this.queue.shift();
        this.port.postMessage({ id: packet.id, epoch: packet.epoch });
      }
      const packet = this.queue[0];
      if (!packet || time < packet.start) continue;
      const position = (time - packet.start) * packet.rate / sampleRate;
      const left = Math.floor(position);
      const a = packet.samples[Math.min(left, packet.samples.length - 1)];
      const b = packet.samples[Math.min(left + 1, packet.samples.length - 1)];
      output[i] = a + (b - a) * (position - left);
    }
    return true;
  }
}
registerProcessor("xmax-external-audio", XmaxExternalAudioProcessor);
`;
