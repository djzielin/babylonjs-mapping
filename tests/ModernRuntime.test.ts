import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineStore, NullEngine, Scene } from "@babylonjs/core";
import TileSet from "../src/core/TileSet";
import { debugLog, setMappingDebugLogger } from "../src/shared/Diagnostics";

vi.mock("../src/core/Attribution", () => ({ default: class { addAttribution() {} } }));

afterEach(() => setMappingDebugLogger());

describe("modern runtime boundaries", () => {
    it("keeps explicit map scenes isolated from Babylon's default scene", () => {
        const engine = new NullEngine();
        const mapScene = new Scene(engine);
        const defaultScene = new Scene(engine);
        const instances = [...EngineStore.Instances];
        new TileSet(mapScene, engine);
        expect(EngineStore.LastCreatedScene).toBe(defaultScene);
        expect(EngineStore.Instances).toEqual(instances);
        expect(defaultScene.meshes).toHaveLength(0);
        mapScene.dispose(); defaultScene.dispose(); engine.dispose();
    });
    it("formats diagnostics only when a consumer opts in", () => {
        const message = vi.fn(() => ["tile", 42]);
        debugLog(message); expect(message).not.toHaveBeenCalled();
        const sink = vi.fn(); setMappingDebugLogger(sink);
        debugLog(message); expect(sink).toHaveBeenCalledWith("tile", 42);
        setMappingDebugLogger(); debugLog(message);
        expect(message).toHaveBeenCalledTimes(1);
    });
});
