export type RecordingStatus = "idle" | "starting" | "recording" | "stopping";

export function RecordingControl({ status, disabled, onToggle }: {
  status: RecordingStatus;
  disabled: boolean;
  onToggle: () => void;
}) {
  const active = status === "recording";
  const pending = status === "starting" || status === "stopping";
  const label = status === "starting" ? "准备录制…" : status === "stopping" ? "正在保存…"
    : active ? "停止录制" : "开始录制";
  return (
    <button type="button" className={`recordingButton${active ? " active" : ""}`}
      aria-label={label} title={label} aria-pressed={active} aria-busy={pending}
      disabled={pending || (!active && disabled)} onClick={onToggle}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {active ? <rect x="5" y="5" width="14" height="14" rx="3" /> : <circle cx="12" cy="12" r="7" />}
      </svg>
      <span>{status === "starting" ? "准备中" : status === "stopping" ? "保存中" : active ? "停止录制" : "录制"}</span>
    </button>
  );
}
