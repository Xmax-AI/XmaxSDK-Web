import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordingControl } from "../src/recording/RecordingControl";
import { RecordingSaveDialog, saveRecording } from "../src/recording/RecordingSaveDialog";

it("places file size after the filename in the same metadata row", () => {
  const result = { blob: new Blob([new Uint8Array(1024 * 1024)]), fileName: "test.mp4" };
  const html = renderToStaticMarkup(<RecordingSaveDialog result={result} onClose={() => {}} />);
  expect(html).toContain('<div class="recordingFileInfo"><span class="recordingFileName">test.mp4</span><span class="recordingFileSize">1.0 MB</span></div>');
  expect(html).not.toContain("不含插帧和界面");
});

it.each(["idle", "starting", "recording", "stopping"])("renders recording state %s", status => {
  const html = renderToStaticMarkup(<RecordingControl status={status} disabled={false} onToggle={() => {}} />);
  expect(html).toContain(`aria-pressed="${status === "recording"}"`);
  expect(html.includes('disabled=""')).toBe(status === "starting" || status === "stopping");
  expect(html).toContain(status === "recording" ? "停止录制" : status === "stopping" ? "正在保存" : status === "starting" ? "准备录制" : "开始录制");
});

it("allows stopping even when generation has ended", () => {
  const onToggle = vi.fn();
  const control = RecordingControl({ status: "recording", disabled: true, onToggle });
  expect(control.props.disabled).toBe(false);
  control.props.onClick();
  expect(onToggle).toHaveBeenCalledOnce();
});

it("uses the native save picker and writes the completed blob", async () => {
  const file = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  const picker = vi.fn(async () => ({ createWritable: async () => file }));
  vi.stubGlobal("window", { showSaveFilePicker: picker });
  try {
    const blob = new Blob(["video"], { type: "video/mp4" });
    const save = saveRecording({ blob, fileName: "test.mp4" }, "blob:result");
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: "test.mp4" }));
    await save;
    expect(file.write).toHaveBeenCalledWith(blob);
    expect(file.close).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});

it("falls back to a download link when the native picker is unavailable", async () => {
  const anchor = { click: vi.fn(), remove: vi.fn() };
  const appendChild = vi.fn();
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild } });
  try {
    await saveRecording({ blob: new Blob(), fileName: "test.webm" }, "blob:result");
    expect(anchor.href).toBe("blob:result");
    expect(anchor.download).toBe("test.webm");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
