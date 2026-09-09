import { expect, it, vi } from "vitest";
const { createUI, addControl } = vi.hoisted(() => ({ createUI: vi.fn(), addControl: vi.fn() }));
vi.mock("@babylonjs/gui/2D/index.js", () => ({
  AdvancedDynamicTexture: { CreateFullscreenUI: createUI.mockReturnValue({ addControl: vi.fn() }) },
}));
vi.mock("@babylonjs/gui/2D/controls/index.js", () => ({
  StackPanel: class { addControl = addControl; },
  Control: {},
  Button: {
    CreateSimpleButton: (name: string) => ({ name, onPointerUpObservable: { add: vi.fn() } }),
    CreateImageOnlyButton: (name: string) => ({ name, onPointerUpObservable: { add: vi.fn() } }),
  },
}));
import Attribution from "../src/core/Attribution";

it("uses the supplied scene and shares credits across repeated provider updates", () => {
  const scene = {} as never;
  const attribution = new Attribution(scene);
  for (const provider of ["OSM", "MB", "MBMODEL", "OVERTURE", "MB", "OVERTURE"]) {
    attribution.addAttribution(provider);
  }
  expect(createUI).toHaveBeenCalledWith("UI", true, scene);
  expect(addControl.mock.calls.map(([button]) => button.name)).toEqual([
    "button_osm", "button_mb", "button_improve", "button_logo", "button_overture",
  ]);
});
