import { useEffect, useRef, useState } from "react";
import type { XmaxRealtimeManaging } from "@xmaxai/web-sdk";

export function LocalFramePreview({ realtime }: { realtime: XmaxRealtimeManaging }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let active = true;
    void realtime.setLocalMediaFrameListener(({ content }) => {
      if (content.type !== "video") return;
      const { frame } = content.frame;
      try {
        if (!active) return;
        const scale = Math.min(1, 400 / Math.max(frame.displayWidth, frame.displayHeight));
        const width = Math.max(1, Math.round(frame.displayWidth * scale));
        const height = Math.max(1, Math.round(frame.displayHeight * scale));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        context.drawImage(frame, 0, 0, width, height);
      } finally {
        frame.close();
      }
    }).catch(error => {
      if (active) {
        setError(error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      active = false;
      void realtime.setLocalMediaFrameListener().catch(() => {});
    };
  }, [realtime]);

  return (
    <div className="localFramePreview">
      <span>Local frame callback</span>
      <canvas ref={canvasRef} aria-label="Camera preview drawn from SDK frame callbacks" />
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
