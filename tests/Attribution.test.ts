import { beforeEach, expect, it, vi } from "vitest";
import { NullEngine, Scene, Vector2 } from "@babylonjs/core";
const { createUI, addControl, guiControl } = vi.hoisted(() => ({ createUI: vi.fn(), addControl: vi.fn(), guiControl: vi.fn() }));
vi.mock("@babylonjs/gui/2D/index.js", () => ({
  AdvancedDynamicTexture: { CreateFullscreenUI: createUI.mockImplementation(() => ({ addControl: guiControl, layer: { isEnabled: true } })) },
}));
vi.mock("@babylonjs/gui/2D/controls/index.js", () => ({
  StackPanel: class { addControl = addControl; },
  TextBlock: class { constructor(public name: string) {} },
  Control: {},
  Button: {
    CreateSimpleButton: (name: string) => ({ name, onPointerUpObservable: { add: vi.fn() } }),
    CreateImageOnlyButton: (name: string) => ({ name, onPointerUpObservable: { add: vi.fn() } }),
  },
}));
import Attribution from "../src/core/Attribution";
import GlobeSet from "../src/core/GlobeSet";
import TileSet from "../src/core/TileSet";

beforeEach(() => vi.clearAllMocks());

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

it("defers hidden credits and replays their original order exactly once on explicit GUI access", () => {
  const scene = {} as never;
  const attribution = new Attribution(scene, true);
  for (const provider of ["OVERTURE", "MB", "MBMODEL", "GOOGLE", "MB", "OVERTURE"]) attribution.addAttribution(provider);
  const credits = ["Initial data source"];
  attribution.setGoogleAttributions(credits);
  credits[0] = "Caller mutation";
  attribution.setGoogleAttributions(["Latest data source", "Survey partner"]);
  expect(createUI).not.toHaveBeenCalled();
  expect(addControl).not.toHaveBeenCalled();

  const texture = attribution.advancedTexture;
  expect(createUI).toHaveBeenCalledExactlyOnceWith("UI", true, scene);
  expect(texture.layer?.isEnabled).toBe(false);
  expect(addControl.mock.calls.map(([button]) => button.name)).toEqual([
    "button_osm", "button_overture", "button_mb", "button_improve", "button_logo", "button_google",
  ]);
  const data = guiControl.mock.calls.map(([control]) => control).find(control => control.name === "google data attribution");
  expect(data.text).toBe("Latest data source; Survey partner");
  expect(attribution.advancedTexture).toBe(texture);
  attribution.addAttribution("GOOGLE");
  attribution.setGoogleAttributions([]);
  expect(createUI).toHaveBeenCalledOnce();
  expect(addControl).toHaveBeenCalledTimes(6);
  expect(guiControl.mock.calls.filter(([control]) => control.name === "google data attribution")).toHaveLength(1);
  expect(data.text).toBe("");
});

it("retains a copy of deferred Google data credits", () => {
  const attribution = new Attribution({} as never, true);
  const credits = ["Original data source"];
  attribution.setGoogleAttributions(credits);
  credits[0] = "Changed outside attribution";
  void attribution.advancedTexture;
  const data = guiControl.mock.calls.map(([control]) => control).find(control => control.name === "google data attribution");
  expect(data.text).toBe("Original data source");
});

it("initializes deferred credits on an explicitly supplied GUI without creating a canvas or changing its visibility", () => {
  const attribution = new Attribution({} as never, true);
  attribution.addAttribution("OVERTURE");
  attribution.addAttribution("GOOGLE");
  attribution.setGoogleAttributions(["Stored data source"]);
  const controls = vi.fn();
  const supplied = { addControl: controls, layer: { isEnabled: true } } as unknown as Attribution["advancedTexture"];
  attribution.advancedTexture = supplied;
  expect(attribution.advancedTexture).toBe(supplied);
  expect(createUI).not.toHaveBeenCalled();
  expect(supplied.layer?.isEnabled).toBe(true);
  expect(addControl.mock.calls.map(([button]) => button.name)).toEqual(["button_osm", "button_overture", "button_google"]);
  expect(controls).toHaveBeenCalledTimes(3);
  expect(controls.mock.calls.find(([control]) => control.name === "google data attribution")?.[0].text).toBe("Stored data source");
  attribution.addAttribution("GOOGLE");
  attribution.setGoogleAttributions(["New data source"]);
  expect(controls).toHaveBeenCalledTimes(3);
  expect(addControl).toHaveBeenCalledTimes(3);
  expect(controls.mock.calls.find(([control]) => control.name === "google data attribution")?.[0].text).toBe("New data source");
});

it("preserves writable replacement of an existing GUI", () => {
  const attribution = new Attribution({} as never);
  const supplied = { addControl: vi.fn() } as unknown as Attribution["advancedTexture"];
  attribution.advancedTexture = supplied;
  expect(attribution.advancedTexture).toBe(supplied);
  expect(createUI).toHaveBeenCalledOnce();
  attribution.setGoogleAttributions(["Replacement data source"]);
  expect(supplied.addControl).toHaveBeenCalledOnce();
});

it("keeps hidden globe tiers lazy through geometry and credit updates while defaults remain eager", () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    for (let index = 0; index < 6; index++) {
      const globe = new GlobeSet(scene, engine, { attribution: false, backingSurface: false });
      globe.createGeometry(new Vector2(1, 1), 20, 2);
      globe.updateRaster(35, -79, 13);
      globe.ourAttribution.addAttribution("GOOGLE");
      globe.ourAttribution.setGoogleAttributions(["Retained Google data source"]);
    }
    expect(createUI).not.toHaveBeenCalled();
    expect(guiControl).not.toHaveBeenCalled();
    new GlobeSet(scene, engine, { backingSurface: false });
    expect(createUI).toHaveBeenCalledOnce();
    new TileSet(scene, engine);
    expect(createUI).toHaveBeenCalledTimes(2);
  } finally { scene.dispose(); engine.dispose(); }
});
