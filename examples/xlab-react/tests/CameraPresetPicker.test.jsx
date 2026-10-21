import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RealtimeCameraPreset, cameraPresetSize } from "@xmaxai/web-sdk";
import { CameraPresetPicker } from "../src/CameraPresetPicker";

const presets = [
  [RealtimeCameraPreset.resolution1920x1080, "16:9", 1920, 1080],
  [RealtimeCameraPreset.resolution1080x1920, "9:16", 1080, 1920],
  [RealtimeCameraPreset.resolution1408x1408, "1:1", 1408, 1408],
  [RealtimeCameraPreset.resolution1152x1536, "3:4", 1152, 1536],
  [RealtimeCameraPreset.resolution1536x1152, "4:3", 1536, 1152],
];

it("offers exactly the five SDK camera presets with ratio labels", () => {
  const html = renderToStaticMarkup(
    <CameraPresetPicker value={RealtimeCameraPreset.resolution1920x1080} onChange={() => {}} />,
  );
  expect(html.match(/<option /g)).toHaveLength(5);
  expect(presets.map(([preset]) => preset)).toEqual(Object.values(RealtimeCameraPreset));
  for (const [preset, label] of presets) {
    expect(html).toMatch(new RegExp(`<option value="${preset}"[^>]*>${label}</option>`));
  }
  expect(html).toContain('aria-label="Camera aspect ratio"');
  expect(html).toContain('class="rtcModelSelect"');
});

it.each(presets)("selects %s and requests its SDK preset", (preset, label, width, height) => {
  const onChange = vi.fn();
  const picker = CameraPresetPicker({ value: preset, onChange });
  const select = picker.props.children[0];
  const html = renderToStaticMarkup(picker);
  expect(html).toContain(`<option value="${preset}" selected="">${label}</option>`);
  select.props.onChange({ target: { value: preset } });
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(preset);
  expect(cameraPresetSize(onChange.mock.calls[0][0])).toEqual({ width, height });
});

it("disables selection while starting the camera", () => {
  const html = renderToStaticMarkup(
    <CameraPresetPicker value={RealtimeCameraPreset.resolution1920x1080} disabled onChange={() => {}} />,
  );
  expect(html).toContain('disabled=""');
});
