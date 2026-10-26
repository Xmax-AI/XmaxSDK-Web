/** 将解码器的 GPU/特殊格式帧转成编码器可读取的 CPU 帧，只作用于 XLab 录制。 */
export class RecordingVideoFrameConverter {
  private buffer = new Uint8Array(0);
  private canvas?: OffscreenCanvas;
  private context?: OffscreenCanvasRenderingContext2D;
  private readonly unreadableFormats = new Set<string>();

  /** 返回独立副本；输入帧仍由调用方释放。复用中间缓冲区，不转移其所有权。 */
  async convert(frame: VideoFrame, timestamp: number, duration: number): Promise<VideoFrame> {
    const format = frame.format;
    const rect = frame.visibleRect;
    if (format && rect && ["NV12", "I420", "RGBA", "RGBX", "BGRA", "BGRX"].includes(format) &&
      !this.unreadableFormats.has(format)) {
      try {
        const size = frame.allocationSize();
        if (this.buffer.byteLength < size) this.buffer = new Uint8Array(size);
        const layout = await frame.copyTo(this.buffer);
        return new VideoFrame(this.buffer, { format, layout, codedWidth: rect.width, codedHeight: rect.height,
          displayWidth: frame.displayWidth, displayHeight: frame.displayHeight,
          colorSpace: frame.colorSpace.toJSON(), timestamp, duration });
      } catch {
        // 部分平台无法读取解码器表面，改经画布读取像素；后续同格式不重复探测。
        this.unreadableFormats.add(format);
      }
    }

    const width = frame.displayWidth;
    const height = frame.displayHeight;
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(width, height);
      this.context = this.canvas.getContext("2d", { alpha: false, willReadFrequently: true }) ?? undefined;
      if (!this.context) throw new Error("此浏览器无法转换录制视频帧");
    }
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.context!.drawImage(frame, 0, 0, width, height);
    // 不能只包装 GPU 画布；显式读回字节，确保编码器收到 CPU 可访问的 RGBA。
    const pixels = this.context!.getImageData(0, 0, width, height);
    return new VideoFrame(pixels.data, { format: "RGBA", codedWidth: width, codedHeight: height,
      colorSpace: { primaries: "bt709", transfer: "iec61966-2-1", matrix: "rgb", fullRange: true }, timestamp, duration });
  }
}
