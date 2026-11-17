import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RealtimeCameraFormat, cameraFormatSize } from "@xmaxai/web-sdk";
import { CameraPresetPicker } from "../src/CameraPresetPicker";

const presets = [
  [RealtimeCameraFormat.resolution1920x1080, "16:9", 1920, 1080],
  [RealtimeCameraFormat.resolution1080x1920, "9:16", 1080, 1920],
  [RealtimeCameraFormat.resolution1408x1408, "1:1", 1408, 1408],
  [RealtimeCameraFormat.resolution1152x1536, "3:4", 1152, 1536],
  [RealtimeCameraFormat.resolution1536x1152, "4:3", 1536, 1152],
];
const presetOptions = presets.map(([preset]) => preset);

it("offers the five supplied camera presets with ratio labels", () => {
  const html = renderToStaticMarkup(
    <CameraPresetPicker value={RealtimeCameraFormat.resolution1920x1080} presets={presetOptions} onChange={() => {}} />,
  );
  expect(html.match(/type="radio"/g)).toHaveLength(5);
  expect(Array.from(html.matchAll(/<span>([^<]+)<\/span>/g), ([, label]) => label))
    .toEqual(presets.map(([, label]) => label));
  expect(html).toContain('aria-label="Camera aspect ratio"');
  expect(html).toContain('role="radiogroup"');
});

it.each(presets)("selects %s and requests its SDK preset", (preset, label, width, height) => {
  const onChange = vi.fn();
  const picker = CameraPresetPicker({ value: preset, presets: presetOptions, onChange });
  const selected = picker.props.children.find(option => option.props.children[0].props.checked);
  const [radio, text] = selected.props.children;
  expect(text.props.children).toBe(label);
  expect(selected.props.title).toBe(`${width} × ${height}`);
  radio.props.onChange();
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(preset);
  expect(cameraFormatSize(onChange.mock.calls[0][0])).toEqual({ width, height });
});

it("disables selection while starting the camera", () => {
  const html = renderToStaticMarkup(
    <CameraPresetPicker value={RealtimeCameraFormat.resolution1920x1080} presets={presetOptions} disabled onChange={() => {}} />,
  );
  expect(html.match(/disabled=""/g)).toHaveLength(5);
});

it("shows the same ratio order and selects the matching Flash preset", () => {
  const flash = RealtimeCameraFormat;
  const picker = CameraPresetPicker({
    value: flash.resolution1280x704,
    presets: [flash.resolution704x1280, flash.resolution1280x704, flash.resolution960x960,
      flash.resolution1024x768, flash.resolution768x1024],
    onChange: () => {},
  });
  const options = picker.props.children;
  expect(options.map(option => option.props.children[1].props.children)).toEqual(["16:9", "9:16", "1:1", "3:4", "4:3"]);
  expect(options[0].props.children[0].props).toMatchObject({ checked: true, value: flash.resolution1280x704 });
  expect(options[0].props.title).toBe("1280 × 704");
});
