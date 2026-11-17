import { useCallback, useEffect, useRef, useState } from "react";

export type CaptureInputKind = "videoinput" | "audioinput";

const ALLOW_ACCESS = "allow";
const DEFAULT_INPUT = "default";
const INPUT_OFF = "off";
const DEVICE_PREFIX = "device:";

/** Reads the browser's device list and requests access only on an explicit picker action. */
export function useCaptureDevices(showPickers: boolean) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [requestingAccess, setRequestingAccess] = useState(false);
  const requestInProgress = useRef(false);
  const revision = useRef(0);
  const media = globalThis.navigator?.mediaDevices;

  const refresh = useCallback(async () => {
    if (!media?.enumerateDevices) return;
    const current = ++revision.current;
    const inputs = await media.enumerateDevices();
    if (current === revision.current) setDevices(inputs);
  }, [media]);

  useEffect(() => {
    if (!showPickers || !media) return;
    const refreshList = () => void refresh().catch(() => {});
    refreshList();
    media.addEventListener?.("devicechange", refreshList);
    window.addEventListener("focus", refreshList);
    return () => {
      revision.current += 1;
      media.removeEventListener?.("devicechange", refreshList);
      window.removeEventListener("focus", refreshList);
    };
  }, [media, refresh, showPickers]);

  async function requestAccess(kind: CaptureInputKind) {
    if (!media?.getUserMedia) throw new Error("Browser media access is unavailable.");
    if (requestInProgress.current) return;
    requestInProgress.current = true;
    setRequestingAccess(true);
    let stream: MediaStream | undefined;
    try {
      stream = await media.getUserMedia(kind === "videoinput" ? { video: true } : { audio: true });
      await refresh();
    } finally {
      stream?.getTracks().forEach(track => track.stop());
      requestInProgress.current = false;
      setRequestingAccess(false);
    }
  }

  return { devices, requestingAccess, requestAccess };
}

interface CaptureDevicePickerProps {
  kind: CaptureInputKind;
  devices: readonly MediaDeviceInfo[];
  /** Null is microphone off, undefined is the default input. */
  selected: string | null | undefined;
  disabled: boolean;
  onSelect: (deviceId: string | null | undefined) => void;
  onRequestAccess: (kind: CaptureInputKind) => void;
}

/** Shows default input, available devices, and the microphone-off choice in compact selectors. */
export function CaptureDevicePicker({ kind, devices, selected, disabled, onSelect, onRequestAccess }: CaptureDevicePickerProps) {
  const microphone = kind === "audioinput";
  const label = microphone ? "Microphone" : "Camera";
  const inputs = devices.filter(device => device.kind === kind && device.deviceId && device.deviceId !== DEFAULT_INPUT);
  const value = selected === null ? INPUT_OFF : selected === undefined ? DEFAULT_INPUT : DEVICE_PREFIX + selected;
  const missing = typeof selected === "string" && !inputs.some(device => device.deviceId === selected);

  return (
    <label className="heroInputPicker">
      <select aria-label={label} title={label} value={value} disabled={disabled}
        onChange={event => {
          const input = event.currentTarget.value;
          if (input === ALLOW_ACCESS) onRequestAccess(kind);
          else if (input === INPUT_OFF) onSelect(null);
          else if (input === DEFAULT_INPUT) onSelect(undefined);
          else onSelect(input.slice(DEVICE_PREFIX.length));
        }}>
        {microphone && <option value={INPUT_OFF}>Microphone off</option>}
        <option value={DEFAULT_INPUT}>Default {label.toLowerCase()}</option>
        {inputs.map((device, index) => (
          <option key={device.deviceId} value={DEVICE_PREFIX + device.deviceId}>
            {device.label.replace(/\s*\([\da-f]{4}:[\da-f]{4}\)\s*$/i, "") || `${label} ${index + 1}`}
          </option>
        ))}
        {missing && <option value={value} disabled>{label} unavailable</option>}
        {inputs.length === 0 && <option value={ALLOW_ACCESS}>Allow {label.toLowerCase()} access…</option>}
      </select>
    </label>
  );
}
