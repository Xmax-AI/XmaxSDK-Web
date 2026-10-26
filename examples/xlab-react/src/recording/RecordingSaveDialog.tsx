import { useEffect, useRef, useState } from "react";
import type { RecordingResult } from "./recordingMessages";

interface SaveWindow extends Window {
  showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  }>;
}

/** 支持 File System Access 时弹出原生保存窗口，其他浏览器使用标准下载。 */
export async function saveRecording(result: RecordingResult, url: string): Promise<void> {
  const picker = (window as SaveWindow).showSaveFilePicker;
  if (picker) {
    const extension = result.fileName.endsWith(".mp4") ? ".mp4" : ".webm";
    const handle = await picker.call(window, { suggestedName: result.fileName,
      types: [{ description: "Video", accept: { [result.blob.type]: [extension] } }] });
    const file = await handle.createWritable();
    try {
      await file.write(result.blob);
      await file.close();
    } catch (error) {
      await file.abort().catch(() => {});
      throw error;
    }
  } else {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
}

export function RecordingSaveDialog({ result, onClose }: { result: RecordingResult; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const objectURL = URL.createObjectURL(result.blob);
    setUrl(objectURL);
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(objectURL);
  }, [result]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await saveRecording(result, url);
      setSaved(true);
    } catch (failure) {
      if (!(failure instanceof Error && failure.name === "AbortError")) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} className="recordingDialog" aria-labelledby="recording-save-title"
      onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
      <div className="recordingDialogHeading">
        <h2 id="recording-save-title">保存录制</h2>
        <button type="button" aria-label="关闭保存弹窗" disabled={saving} onClick={onClose}>×</button>
      </div>
      {url && <video src={url} controls playsInline preload="metadata" />}
      <div className="recordingFileInfo">
        <span className="recordingFileName">{result.fileName}</span>
        <span className="recordingFileSize">{(result.blob.size / 1024 / 1024).toFixed(1)} MB</span>
      </div>
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">已保存或已发起下载</p>}
      <div className="recordingDialogActions">
        <button type="button" disabled={saving} onClick={onClose}>关闭</button>
        <button type="button" className="primary" disabled={saving || !url} onClick={() => void save()}>
          {saving ? "正在保存…" : "保存视频"}
        </button>
      </div>
    </dialog>
  );
}
