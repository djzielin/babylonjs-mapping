import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcRotateCamera, AssetContainer, Matrix, Mesh, NullEngine, RawTexture, Scene, SubMesh, TransformNode, Vector2, Vector3, VertexBuffer } from "@babylonjs/core";

import Google3DTiles, {
  GOOGLE_3D_TILES_ROOT_URL,
  type Google3DTile,
  type Google3DTileset,
  type GoogleModelTileLoader,
  type LoadedGoogleModelTile,
  type GoogleTilesetLoader,
  parseGoogleGLBMetadata,
} from "../src/Google3DTiles";
import { removeCoastalSkirtTriangles } from "../src/google/Google3DTiles";
import { EPSG_Type } from "../src/core/TileMath";
import TileSet from "../src/TileSet";
import GlobeSet from "../src/GlobeSet";
import { PerformanceConfigurator } from "@babylonjs/core/Engines/performanceConfigurator";

vi.mock("../src/core/Attribution", () => ({
  default: class AttributionStub {
    public advancedTexture = {};
    public addAttribution = vi.fn();
    public setGoogleAttributions = vi.fn();
  },
}));

function createTileSet() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tileSet = new TileSet(scene, engine);
  tileSet.createGeometry(new Vector2(1, 1), 100, 1);
  tileSet.updateRaster(0, 0, 2);
  return { engine, scene, tileSet };
}

function createGLB(json: Record<string, unknown>): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + paddedLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, paddedLength).fill(32);
  new Uint8Array(buffer, 20, encoded.length).set(encoded);
  return buffer;
}

function createModelLoader(requests: string[]) {
  const loader: GoogleModelTileLoader = vi.fn(async (url, scene) => {
    requests.push(url);
    const asset = new AssetContainer(scene);
    asset.rootNodes.push(new TransformNode("google-model", scene));
    return {
      asset,
      attributions: ["Google imagery", "Open data"],
      rtcCenter: Vector3.Zero(),
    };
  });
  return loader;
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("removes deep coastal Google skirts while retaining the surface and building walls", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mesh = new Mesh("coastal photogrammetry", scene);
  const positions = new Float32Array(32 * 3);
  for (let i = 0; i < 32; i++) {
    positions[i * 3] = i % 8;
    positions[i * 3 + 1] = -5;
    positions[i * 3 + 2] = Math.floor(i / 8);
  }
  positions[30 * 3 + 1] = -55;
  positions[31 * 3 + 1] = 35;
  positions[28 * 3] = 90;
  positions[29 * 3] = 200;
  mesh.setVerticesData(VertexBuffer.PositionKind, positions);
  const triangles = [0, 1, 8, 0, 1, 28, 0, 1, 29, 0, 1, 30, 0, 1, 31];
  mesh.setIndices(triangles);
  mesh.position.y = 5;
  expect(removeCoastalSkirtTriangles(mesh, 1)).toBe(3);
  expect(Array.from(mesh.getIndices()!)).toEqual([0, 1, 8, 0, 1, 31]);
  mesh.setIndices(triangles);
  mesh.subMeshes.push(mesh.subMeshes[0]);
  expect(removeCoastalSkirtTriangles(mesh, 1)).toBe(0);
  expect(Array.from(mesh.getIndices()!)).toEqual(triangles);
  mesh.subMeshes.pop();
  mesh.position.y = 105;
  expect(removeCoastalSkirtTriangles(mesh, 1)).toBe(0);
  expect(Array.from(mesh.getIndices()!)).toEqual(triangles);
  scene.dispose(); engine.dispose();
});

it("filters coastal triangles in every material submesh without changing their materials", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mesh = new Mesh("coastal multi material", scene);
  const positions = new Float32Array(32 * 3);
  for (let i = 0; i < 32; i++) {
    positions[i * 3] = i % 8;
    positions[i * 3 + 1] = -5;
  }
  positions[28 * 3] = 90;
  positions[29 * 3 + 1] = -55;
  positions[30 * 3] = 100;
  positions[31 * 3 + 1] = 35;
  mesh.setVerticesData(VertexBuffer.PositionKind, positions);
  mesh.setIndices([0, 1, 8, 0, 1, 28, 0, 1, 29, 0, 1, 30, 0, 1, 31]);
  mesh.releaseSubMeshes();
  new SubMesh(0, 0, 32, 0, 6, mesh);
  new SubMesh(1, 0, 32, 6, 9, mesh);
  mesh.position.y = 5;
  expect(removeCoastalSkirtTriangles(mesh, 1)).toBe(3);
  expect(Array.from(mesh.getIndices()!)).toEqual([0, 1, 8, 0, 1, 31]);
  expect(mesh.subMeshes.map(subMesh => [subMesh.materialIndex, subMesh.indexStart, subMesh.indexCount]))
    .toEqual([[0, 0, 3], [1, 3, 3]]);
  scene.dispose(); engine.dispose();
});

it("removes a small Google water-fill primitive but keeps local coastal surface", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mesh = new Mesh("four vertex water fill", scene);
  mesh.setVerticesData(VertexBuffer.PositionKind, [0, 0, 0, 40, 0, 0, 0, 0, 40, 40, 0, 40]);
  mesh.setIndices([0, 1, 2, 1, 3, 2]);
  expect(removeCoastalSkirtTriangles(mesh, 1)).toBe(2);
  expect(mesh.getIndices()).toHaveLength(0);
  mesh.setVerticesData(VertexBuffer.PositionKind, [0, 0, 0, 12, 0, 0, 0, 0, 12, 12, 0, 12]);
  mesh.setIndices([0, 1, 2, 1, 3, 2]);
  expect(removeCoastalSkirtTriangles(mesh, 1)).toBe(0);
  expect(mesh.getIndices()).toHaveLength(6);
  scene.dispose(); engine.dispose();
});

it("measures coastal Google skirts radially on a globe", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mesh = new Mesh("waterfront on curved globe", scene);
  const positions = new Float32Array(32 * 3);
  const setPoint = (index: number, altitude: number, z: number) => {
    const radius = 60 + altitude * 0.01;
    positions[index * 3] = Math.sqrt(radius * radius - 35 * 35 - z * z);
    positions[index * 3 + 1] = 35;
    positions[index * 3 + 2] = z;
  };
  for (let index = 0; index < 30; index++) setPoint(index, 0, index * 0.002);
  setPoint(30, -40, 0.01);
  setPoint(31, 30, 0.015);
  mesh.setVerticesData(VertexBuffer.PositionKind, positions);
  mesh.setIndices([0, 1, 8, 0, 1, 30, 0, 1, 31]);
  expect(removeCoastalSkirtTriangles(mesh, 0.01, 60)).toBe(1);
  expect(Array.from(mesh.getIndices()!)).toEqual([0, 1, 8, 0, 1, 31]);
  const small = new Mesh("four vertex radial skirt", scene);
  const compact = new Float32Array(12);
  compact.set(positions.subarray(0, 9));
  compact.set(positions.subarray(30 * 3, 31 * 3), 9);
  small.setVerticesData(VertexBuffer.PositionKind, compact);
  small.setIndices([0, 1, 2, 0, 1, 3]);
  expect(removeCoastalSkirtTriangles(small, 0.01, 60)).toBe(1);
  expect(Array.from(small.getIndices()!)).toEqual([0, 1, 2]);
  scene.dispose(); engine.dispose();
});

it("removes a coastal fin lip attached to a discarded deep skirt", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mesh = new Mesh("connected coastal fin", scene);
  const positions = new Float32Array(32 * 3);
  const point = (index: number, elevation: number) => {
    const radius = 60 + elevation * 0.01;
    const z = index * 0.002;
    positions[index * 3] = Math.sqrt(radius * radius - 35 * 35 - z * z);
    positions[index * 3 + 1] = 35;
    positions[index * 3 + 2] = z;
  };
  for (let index = 0; index < 32; index++) point(index, 0);
  point(27, 70); // An unrelated building wall must remain.
  point(30, -40);
  point(31, 70);
  mesh.setVerticesData(VertexBuffer.PositionKind, positions);
  mesh.setIndices([0, 1, 2, 0, 30, 31, 0, 28, 31, 1, 2, 27]);
  mesh.releaseSubMeshes();
  new SubMesh(0, 0, 32, 0, 6, mesh);
  new SubMesh(1, 0, 32, 6, 6, mesh);
  expect(removeCoastalSkirtTriangles(mesh, 0.01, 60)).toBe(2);
  expect(Array.from(mesh.getIndices()!)).toEqual([0, 1, 2, 1, 2, 27]);
  expect(mesh.subMeshes.map(subMesh => [subMesh.materialIndex, subMesh.indexStart, subMesh.indexCount]))
    .toEqual([[0, 0, 3], [1, 3, 3]]);
  scene.dispose(); engine.dispose();
});

it("restricts coverage updates to geographic tiles intersecting changed models", () => {
  const {engine,scene,tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet);
  const radians=Math.PI/180;
  (provider as any).loadedSelections.set("near",{
    url:"near",depth:1,boundingVolume:{region:[-74.01*radians,40.74*radians,-73.98*radians,40.76*radians,0,1000]},
  });
  expect(provider.coverageChangesIntersect([],40.7,-74.1,40.8,-73.9)).toBe(false);
  expect(provider.coverageChangesIntersect(["near"],40.74,-73.99,40.75,-73.98)).toBe(true);
  expect(provider.coverageChangesIntersect(["near"],40.6,-74.1,40.7,-74.0)).toBe(false);
  const longitude=-73.9857*radians,latitude=40.7484*radians;
  const eccentricitySquared=0.00669437999014;
  const radius=6378137/Math.sqrt(1-eccentricitySquared*Math.sin(latitude)**2);
  (provider as any).loadedSelections.set("sphere",{
    url:"sphere",depth:1,boundingVolume:{sphere:[radius*Math.cos(latitude)*Math.cos(longitude),
      radius*Math.cos(latitude)*Math.sin(longitude),radius*(1-eccentricitySquared)*Math.sin(latitude),500]},
  });
  expect(provider.coverageChangesIntersect(["sphere"],40.74,-74.0,40.76,-73.97)).toBe(true);
  expect(provider.coverageChangesIntersect(["sphere"],40.6,-74.1,40.7,-74.0)).toBe(false);
  (provider as any).loadedSelections.set("box",{
    url:"box",depth:1,boundingVolume:{box:[radius*Math.cos(latitude)*Math.cos(longitude),
      radius*Math.cos(latitude)*Math.sin(longitude),radius*(1-eccentricitySquared)*Math.sin(latitude),
      100,0,0,0,100,0,0,0,100]},
  });
  expect(provider.coverageChangesIntersect(["box"],40.74,-74.0,40.76,-73.97)).toBe(true);
  expect(provider.coverageChangesIntersect(["box"],40.6,-74.1,40.7,-74.0)).toBe(false);
  (provider as any).loadedSelections.set("dateline",{
    url:"dateline",depth:1,boundingVolume:{region:[179*radians,-radians,-179*radians,radians,0,1000]},
  });
  expect(provider.coverageChangesIntersect(["dateline"],-0.5,-179.8,0.5,-179.2)).toBe(true);
  expect(provider.coverageChangesIntersect(["dateline"],-0.5,-1,0.5,1)).toBe(false);
  // Unknown metadata must retain a full visibility pass rather than hide a tile.
  expect(provider.coverageChangesIntersect(["unknown"],40.6,-74.1,40.7,-74.0)).toBe(true);
  provider.dispose();scene.dispose();engine.dispose();
});

it("suppresses an Overture footprint when a resident Google tile clips its edge", () => {
  const {engine,scene,tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet);
  const radians=Math.PI/180;
  (provider as any).loadedSelections.set("edge", {
    url:"edge",depth:1,boundingVolume:{region:[-73.9902*radians,40.7402*radians,
      -73.9901*radians,40.7408*radians,0,1000]},
  });
  // A known selection is not coverage until its model is in the scene.
  expect(provider.overlapsFootprint(40.74,-73.991,40.741,-73.99)).toBe(false);
  (provider as any).loadedTiles.set("edge", {});
  expect(provider.overlapsFootprint(40.74,-73.991,40.741,-73.99)).toBe(true);
  expect(provider.overlapsFootprint(40.74,-73.993,40.741,-73.992)).toBe(false);
  (provider as any).loadedTiles.delete("edge");
  expect(provider.overlapsFootprint(40.74,-73.991,40.741,-73.99)).toBe(false);
  provider.dispose();scene.dispose();engine.dispose();
});

it("keeps Overture outside a narrow rotated Google box despite its loose geographic envelope", () => {
  const {engine,scene,tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet);
  const latitude=40.7484*Math.PI/180,longitude=-73.9857*Math.PI/180;
  const eccentricitySquared=0.00669437999014;
  const radius=6378137/Math.sqrt(1-eccentricitySquared*Math.sin(latitude)**2);
  const center=new Vector3(radius*Math.cos(latitude)*Math.cos(longitude),
    radius*Math.cos(latitude)*Math.sin(longitude),radius*(1-eccentricitySquared)*Math.sin(latitude));
  const up=center.normalizeToNew();
  const east=new Vector3(-Math.sin(longitude),Math.cos(longitude),0);
  const north=Vector3.Cross(up,east).normalize();
  const longAxis=east.add(north).normalize().scale(100);
  const narrowAxis=east.subtract(north).normalize().scale(2);
  const vertical=up.scale(50);
  (provider as any).loadedSelections.set("rotated",{url:"rotated",depth:1,boundingVolume:{box:[
    ...center.asArray(),...longAxis.asArray(),...narrowAxis.asArray(),...vertical.asArray(),
  ]}});
  (provider as any).loadedTiles.set("rotated",{});
  expect(provider.coversLocation(40.7484,-73.9857)).toBe(true);
  expect(provider.overlapsFootprint(40.74839,-73.98571,40.74841,-73.98569)).toBe(true);
  expect(provider.coversLocation(40.7484,-73.9847)).toBe(false);
  expect(provider.overlapsFootprint(40.74839,-73.98471,40.74841,-73.98469)).toBe(false);
  (provider as any).loadedTiles.clear();
  provider.dispose();scene.dispose();engine.dispose();
});

it("keeps Overture where retired Google models or partial tile coverage leave gaps", () => {
  const {engine,scene,tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet);
  const radians=Math.PI/180;
  const selection=(url:string,west:number,east:number)=>({url,depth:1,
    boundingVolume:{region:[west*radians,40.74*radians,east*radians,40.75*radians,0,1000]}});
  const loaded=(provider as any).loadedTiles as Map<string, unknown>;
  const selections=(provider as any).loadedSelections as Map<string, unknown>;
  selections.set("left",selection("left",-74.002,-74.001));loaded.set("left",{});
  selections.set("right",selection("right",-74.001,-74));loaded.set("right",{});
  expect(provider.coversLocation(40.745,-74.0015)).toBe(true);
  expect(provider.coversLocation(40.745,-74.0005)).toBe(true);
  expect(provider.coversAreaCompletely(40.742,-74.0018,40.748,-74.0002)).toBe(false);
  selections.set("full",selection("full",-74.002,-74));loaded.set("full",{});
  expect(provider.coversAreaCompletely(40.742,-74.0018,40.748,-74.0002)).toBe(true);
  loaded.delete("full");loaded.delete("left");
  expect(provider.coversAreaCompletely(40.742,-74.0018,40.748,-74.0002)).toBe(false);
  expect(provider.coversLocation(40.745,-74.0015)).toBe(false);
  expect(provider.overlapsFootprint(40.744,-74.0018,40.746,-74.0012)).toBe(false);
  loaded.clear();
  provider.dispose();scene.dispose();engine.dispose();
});

it("shows Overture only until a Google model covers the same building footprint", async () => {
  const {default: BuildingsOverture}=await import("../src/buildings/BuildingsOverture");
  const engine=new NullEngine(),scene=new Scene(engine);
  const globe=new GlobeSet(scene,engine,{radius:60,attribution:false});
  globe.createGeometry(new Vector2(1,1),20,2);globe.updateRaster(40.7484,-73.9857,14);
  const tile=globe.ourTiles[0], google=new Google3DTiles(globe);
  const overture=new BuildingsOverture(globe,"https://example.invalid/buildings.pmtiles");
  overture.batchGeometry=true;overture.doMerge=true;
  overture.batchVisibilityFilter=(lat,lon,bounds)=>!google.coversLocation(lat,lon)
    && !(bounds && google.overlapsFootprint(bounds.south,bounds.west,bounds.north,bounds.east));
  const feature={type:"Feature",properties:{height:15},geometry:{type:"Polygon",coordinates:[[
    [-73.9858,40.7483],[-73.9856,40.7483],[-73.9856,40.7485],[-73.9858,40.7485],[-73.9858,40.7483],
  ]]}};
  await (overture as any).buildBatch({tile,tileCoords:tile.tileCoords.clone(),epsgType:EPSG_Type.EPSG_4326},[feature]);
  expect(tile.buildingBatches).toHaveLength(1);
  expect(tile.buildingBatches[0].isEnabled(false)).toBe(true);
  const radians=Math.PI/180;
  (google as any).loadedSelections.set("google",{url:"google",depth:1,boundingVolume:{region:[
    -73.986*radians,40.748*radians,-73.985*radians,40.749*radians,0,1000,
  ]}});
  (google as any).loadedTiles.set("google",{});
  overture.updateBatchVisibility();
  expect(tile.buildingBatches[0].isEnabled(false)).toBe(false);
  (google as any).loadedTiles.delete("google");
  overture.updateBatchVisibility();
  expect(tile.buildingBatches[0].isEnabled(false)).toBe(true);
  google.dispose();scene.dispose();engine.dispose();
});

it("updates only changed resident geographic coverage when tiles swap", () => {
  const {engine,scene,tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet);
  const radians=Math.PI/180;
  const selection=(url:string,west:number,east:number)=>({url,depth:1,
    boundingVolume:{region:[west*radians,40.74*radians,east*radians,40.75*radians,0,1000]}});
  const stable=selection("stable",-74.01,-74.009);
  const changing=selection("changing",-73.99,-73.989);
  (provider as any).loadedSelections.set("stable",stable);
  (provider as any).loadedSelections.set("changing",changing);
  (provider as any).loadedTiles.set("stable",{});
  (provider as any).loadedTiles.set("changing",{});
  expect(provider.coversLocation(40.745,-74.0095)).toBe(true);
  expect(provider.coversLocation(40.745,-73.9895)).toBe(true);
  const stableCell=(provider as any).coverageIndex.get("-74010/40745");
  const fullResidentScan=vi.spyOn((provider as any).loadedTiles,"keys");
  (provider as any).loadedSelections.set("changing",selection("changing",-73.97,-73.969));
  (provider as any).coverageKey="";
  expect(provider.coversLocation(40.745,-73.9895)).toBe(false);
  expect(provider.coversLocation(40.745,-73.9695)).toBe(true);
  expect((provider as any).coverageIndex.get("-74010/40745")).toBe(stableCell);
  (provider as any).loadedTiles.delete("changing");
  (provider as any).coverageKey="";
  expect(provider.coversLocation(40.745,-73.9695)).toBe(false);
  expect(provider.coversLocation(40.745,-74.0095)).toBe(true);
  expect(fullResidentScan).not.toHaveBeenCalled();
  fullResidentScan.mockRestore();
  (provider as any).loadedTiles.delete("stable");
  provider.dispose();scene.dispose();engine.dispose();
});

describe("parseGoogleGLBMetadata", () => {
  it("extracts sorted-source inputs and CESIUM_RTC metadata from a GLB JSON chunk", () => {
    const metadata = parseGoogleGLBMetadata(createGLB({
      asset: { copyright: "Google; Open data; Google" },
      extensions: { CESIUM_RTC: { center: [1, 2, 3] } },
    }));

    expect(metadata.attributions).toEqual(["Google", "Open data", "Google"]);
    expect(metadata.rtcCenter?.asArray()).toEqual([1, 2, 3]);
  });

  it("returns an empty result for non-GLB input", () => {
    expect(parseGoogleGLBMetadata(new ArrayBuffer(20))).toEqual({ attributions: [] });
  });
});

describe("Google3DTiles", () => {
  it("repairs WebGPU model mip levels after the upload frame", async () => {
    const { engine, scene, tileSet } = createTileSet();
    Object.defineProperty(engine, "isWebGPU", { value: true });
    const generated: object[] = [];
    (engine as any)._generateMipmaps = (internal: object) => generated.push(internal);
    let internal: object | null = null;
    let modelRoot: TransformNode | undefined;
    let modelStarted!: () => void;
    const started = new Promise<void>(resolve => { modelStarted = resolve; });
    const provider = new Google3DTiles(tileSet, {
      apiKey: "test",
      tilesetLoader: async () => ({ root: { content: { uri: "model.glb" } } }),
      modelTileLoader: async (_url, scene) => {
        const asset = new AssetContainer(scene);
        modelRoot = new TransformNode("google-model", scene);
        asset.rootNodes.push(modelRoot);
        const texture = new RawTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 5, scene, true);
        internal = texture.getInternalTexture();
        asset.textures.push(texture);
        modelStarted();
        return { asset, attributions: [] };
      },
    });
    const loading = provider.load();
    await started;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(generated).toEqual([]);
    expect(provider.loadedModelTiles).toHaveLength(0);
    expect(modelRoot!.isEnabled()).toBe(false);
    engine.onEndFrameObservable.notifyObservers(engine);
    await loading;
    expect(generated).toEqual([internal]);
    expect(provider.loadedModelTiles).toHaveLength(1);
    expect(modelRoot!.isEnabled()).toBe(true);
    provider.dispose(); scene.dispose(); engine.dispose();
  });

  it("keeps the Google parent visible through a replacement's WebGPU upload frame", async () => {
    const { engine, scene, tileSet } = createTileSet();
    Object.defineProperty(engine, "isWebGPU", { value: true });
    (engine as any)._generateMipmaps = vi.fn();
    let childStarted!: () => void;
    const started = new Promise<void>(resolve => { childStarted = resolve; });
    let childRoot: TransformNode | undefined;
    const provider = new Google3DTiles(tileSet, { apiKey: "test", maximumScreenSpaceError: 1, maxDepth: 0,
      tilesetLoader: async () => ({ root: { content: { uri: "parent.glb" }, children: [{ content: { uri: "child.glb" } }] } }),
      modelTileLoader: async url => {
        const asset = new AssetContainer(scene);
        const root = new TransformNode(url, scene);
        asset.rootNodes.push(root);
        if (url.includes("child.glb")) {
          childRoot = root;
          asset.textures.push(new RawTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 5, scene, true));
          childStarted();
        }
        return { asset, attributions: [] };
      } });
    const [parent] = await provider.load();
    provider.maxDepth = 4;
    const refining = provider.load();
    await started;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(parent.root.isEnabled()).toBe(true);
    expect(childRoot!.isEnabled()).toBe(false);
    engine.onEndFrameObservable.notifyObservers(engine);
    await refining;
    expect(childRoot!.isEnabled()).toBe(true);
    expect(parent.root.isEnabled()).toBe(false);
    provider.dispose(); scene.dispose(); engine.dispose();
  });

  it("retains the Google parent if replacement mip generation fails", async () => {
    const { engine, scene, tileSet } = createTileSet();
    Object.defineProperty(engine, "isWebGPU", { value: true });
    (engine as any)._generateMipmaps = () => { throw new Error("GPU upload failed"); };
    let childStarted!: () => void;
    const started = new Promise<void>(resolve => { childStarted = resolve; });
    const provider = new Google3DTiles(tileSet, { apiKey: "test", maximumScreenSpaceError: 1, maxDepth: 0,
      tilesetLoader: async () => ({ root: { content: { uri: "parent.glb" }, children: [{ content: { uri: "child.glb" } }] } }),
      modelTileLoader: async url => {
        const asset = new AssetContainer(scene);
        asset.rootNodes.push(new TransformNode(url, scene));
        if (url.includes("child.glb")) {
          asset.textures.push(new RawTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 5, scene, true));
          childStarted();
        }
        return { asset, attributions: [] };
      } });
    const [parent] = await provider.load();
    provider.maxDepth = 4;
    const refining = provider.load();
    await started;
    await new Promise(resolve => setTimeout(resolve, 0));
    engine.onEndFrameObservable.notifyObservers(engine);
    expect(await refining).toEqual([parent]);
    expect(parent.root.isEnabled()).toBe(true);
    provider.dispose(); scene.dispose(); engine.dispose();
  });

  it("reuses model assets and hierarchy when zooming out and back", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const requests: string[] = [];
    const tilesetLoader = vi.fn(async () => ({ root: {
      content: { uri: "coarse.glb" }, children: [{ content: { uri: "fine.glb" } }],
    } }));
    const provider = new Google3DTiles(tileSet, { apiKey: "test", tilesetLoader,
      modelTileLoader: createModelLoader(requests), maxDepth: 1 });
    const fine = (await provider.load())[0];
    provider.maxDepth = 0;
    await provider.load();
    expect(fine.root.isEnabled()).toBe(false);
    provider.maxDepth = 1;
    expect((await provider.load())[0].asset).toBe(fine.asset);
    expect(fine.root.isEnabled()).toBe(true);
    expect(requests).toHaveLength(2);
    expect(tilesetLoader).toHaveBeenCalledTimes(1);
    provider.dispose(); scene.dispose(); engine.dispose();
  });

  it("streams the first model before a slower sibling hierarchy finishes", async () => {
    const { engine, scene, tileSet } = createTileSet();
    let release!: (value: Google3DTileset) => void;
    const slow = new Promise<Google3DTileset>(resolve => { release = resolve; });
    const requests: string[] = [];
    const provider = new Google3DTiles(tileSet, { apiKey: "test",
      tilesetLoader: async url => url.includes("slow.json") ? slow : { root: { children: [
        { content: { uri: "first.glb" } }, { content: { uri: "slow.json" } },
      ] } }, modelTileLoader: createModelLoader(requests) });
    const loading = provider.load();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    release({ root: { content: { uri: "second.glb" } } });
    await loading;
    expect(requests).toHaveLength(2);
    provider.dispose(); scene.dispose(); engine.dispose();
  });

  it.each([
    { region: [-0.001, -0.001, 0.001, 0.001, 0, 200] },
    { box: [6378137, 0, 0, 200, 0, 0, 0, 200, 0, 0, 0, 200] },
    { sphere: [6378137, 0, 0, 200] },
  ])("limits building replacement to successfully loaded coverage %j", async boundingVolume => {
    const { engine, scene, tileSet } = createTileSet();
    const provider = new Google3DTiles(tileSet, {
      apiKey: "test", tilesetLoader: async () => ({ root: { boundingVolume, content: { uri: "model.glb" } } }),
      modelTileLoader: createModelLoader([]),
    });
    expect(provider.coversLocation(0, 0)).toBe(false);
    await provider.load();
    expect(provider.coversLocation(0, 0)).toBe(true);
    expect(provider.coversLocation(1, 1)).toBe(false);
    provider.dispose();
    expect(provider.coversLocation(0, 0)).toBe(false);
    scene.dispose(); engine.dispose();
  });

  it("keeps parent content when replacement descendants are empty", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const requests: string[] = [];
    const provider = new Google3DTiles(tileSet, {
      apiKey: "test", tilesetLoader: async () => ({ root: {
        content: { uri: "parent.glb" }, children: [{ geometricError: 0 }],
      } }), modelTileLoader: createModelLoader(requests),
    });
    expect(await provider.load()).toHaveLength(1);
    expect(requests[0]).toContain("parent.glb");
    provider.dispose(); scene.dispose(); engine.dispose();
  });

  it("adds the API key and session to Google child URLs while traversing content", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const requests: string[] = [];
    const externalURL = "https://tile.googleapis.com/v1/3dtiles/city.json?session=session-123&key=test-key";
    const tilesetLoader: GoogleTilesetLoader = vi.fn(async (url) => {
      if (url.includes("root.json")) {
        return {
          root: {
            boundingVolume: { region: [-Math.PI, -Math.PI / 2, Math.PI, Math.PI / 2, 0, 100] },
            content: { uri: "/v1/3dtiles/city.json?session=session-123" },
          },
        } satisfies Google3DTileset;
      }
      expect(url).toBe(externalURL);
      return {
        root: {
          boundingVolume: { region: [-0.5, -0.5, 0.5, 0.5, 0, 100] },
          content: { uri: "city.glb" },
        },
      } satisfies Google3DTileset;
    });
    const modelLoader = createModelLoader(requests);
    const google = new Google3DTiles(tileSet, {
      apiKey: "test-key",
      tilesetLoader,
      modelTileLoader: modelLoader,
      maxDepth: 3,
      maxTiles: 4,
    });

    const loaded = await google.load();

    expect(tilesetLoader).toHaveBeenCalledWith(
      `${GOOGLE_3D_TILES_ROOT_URL}?key=test-key`,
    );
    expect(requests).toEqual([
      "https://tile.googleapis.com/v1/3dtiles/city.glb?session=session-123&key=test-key",
    ]);
    expect(google.sessionToken).toBe("session-123");
    expect(loaded).toHaveLength(1);
    expect(google.getAttributions()).toEqual(["Google imagery", "Open data"]);
    expect(tileSet.ourAttribution.addAttribution).toHaveBeenCalledWith("GOOGLE");
    expect(tileSet.ourAttribution.setGoogleAttributions).toHaveBeenCalledWith([
      "Google imagery",
      "Open data",
    ]);

    await google.load();
    expect(tilesetLoader).toHaveBeenCalledTimes(2);
    expect(modelLoader).toHaveBeenCalledOnce();

    google.dispose();
    expect(loaded[0].root.isDisposed()).toBe(true);
    scene.dispose();
    engine.dispose();
  });

  it("filters region children and places imported coordinates in local ENU space", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const requests: string[] = [];
    const outsideTile: Google3DTile = {
      boundingVolume: { region: [2, -0.5, 2.5, 0.5, 0, 100] },
      content: { uri: "outside.glb" },
    };
    const insideTile: Google3DTile = {
      boundingVolume: { region: [-0.5, -0.5, 0.5, 0.5, 0, 100] },
      content: { uri: "inside.glb" },
    };
    const tilesetLoader: GoogleTilesetLoader = vi.fn(async () => ({
      root: {
        boundingVolume: { region: [-Math.PI, -Math.PI / 2, Math.PI, Math.PI / 2, 0, 100] },
        children: [outsideTile, insideTile],
      },
    }));
    const modelLoader: GoogleModelTileLoader = vi.fn(async (url, loadScene) => {
      requests.push(url);
      const asset = new AssetContainer(loadScene);
      asset.rootNodes.push(new TransformNode("google-model", loadScene));
      return {
        asset,
        attributions: ["Google"],
        rtcCenter: Vector3.Zero(),
      };
    });
    const google = new Google3DTiles(tileSet, {
      apiKey: "test-key",
      tilesetLoader,
      modelTileLoader: modelLoader,
      maxDepth: 1,
      maxTiles: 4,
      origin: { latitude: 0, longitude: 0 },
    });

    const loaded = await google.load();

    expect(requests).toEqual([
      "https://tile.googleapis.com/v1/3dtiles/inside.glb?key=test-key",
    ]);
    expect(loaded[0].root.getWorldMatrix().m[0]).toBeCloseTo(0);
    expect(loaded[0].root.getWorldMatrix().m[1]).toBeCloseTo(-tileSet.tileScale, 10);
    expect(loaded[0].root.getWorldMatrix().m[6]).toBeCloseTo(tileSet.tileScale, 10);
    expect(loaded[0].root.getWorldMatrix().m[8]).toBeCloseTo(-tileSet.tileScale, 10);

    google.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("validates the API key and map lifecycle before making requests", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tileSet = new TileSet(scene, engine);
    const google = new Google3DTiles(tileSet);

    await expect(google.load()).rejects.toThrow(
      "Cannot load Google 3D Tiles before createGeometry() has been called.",
    );

    tileSet.createGeometry(new Vector2(1, 1), 100, 1);
    tileSet.updateRaster(0, 0, 2);
    await expect(google.load()).rejects.toThrow(
      "A Google Maps Platform API key is required",
    );

    google.apiKey = "test-key";
    google.maxTiles = 0;
    await expect(google.load()).rejects.toThrow("maxTiles must be a positive integer");

    scene.dispose();
    engine.dispose();
  });
});


describe("Google3DTiles regression coverage", () => {
  it.each([false, true])("rebases, scales and aligns glTF geometry (right handed: %s)", async (rightHanded) => {
    const { engine, scene, tileSet } = createTileSet();
    scene.useRightHandedSystem = rightHanded;
    tileSet.tileScale = 0.5;
    const google = new Google3DTiles(tileSet, {
      apiKey: "test-key", exaggeration: 2,
      tilesetLoader: async () => ({ root: {
        transform: Array.from(Matrix.Translation(6378137, 0, 0).m),
        children: [{ transform: Array.from(Matrix.Translation(10, 20, 30).m), content: { uri: "model.glb" } }],
      } }),
      modelTileLoader: async () => ({ asset: new AssetContainer(scene), attributions: [], rtcCenter: new Vector3(1, 2, 3) }),
    });
    const [tile] = await google.load();
    // Source glTF (4, 5, 6) -> tile (4, -6, 5) -> RTC -> nested transforms.
    const point = Vector3.TransformCoordinates(new Vector3(rightHanded ? 4 : -4, 5, 6), tile.root.getWorldMatrix());
    const mapOrigin = tileSet.ourTileMath.EPSG_to_Game(new Vector2(0, 0), EPSG_Type.EPSG_4326);
    expect(point.x).toBeCloseTo(mapOrigin.x + 8, 5);
    expect(point.y).toBeCloseTo(15, 5);
    expect(point.z).toBeCloseTo(mapOrigin.z + 19, 5);
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it("does not resurrect assets when disposed while fetching the hierarchy", async () => {
    const { engine, scene, tileSet } = createTileSet();
    let resolve!: (value: Google3DTileset) => void;
    const modelTileLoader = createModelLoader([]);
    const google = new Google3DTiles(tileSet, { apiKey: "test-key", modelTileLoader,
      tilesetLoader: () => new Promise(r => { resolve = r; }),
    });
    const loading = google.load();
    google.dispose();
    resolve({ root: { content: { uri: "late.glb" } } });
    expect(await loading).toEqual([]);
    expect(modelTileLoader).not.toHaveBeenCalled();
    expect(google.tileset).toBeUndefined();
    scene.dispose(); engine.dispose();
  });

  it("disposes a late model response after cancellation", async () => {
    const { engine, scene, tileSet } = createTileSet();
    let resolve!: (value: LoadedGoogleModelTile) => void;
    const asset = new AssetContainer(scene);
    const disposed = vi.spyOn(asset, "dispose");
    const google = new Google3DTiles(tileSet, { apiKey: "test-key",
      tilesetLoader: async () => ({ root: { content: { uri: "late.glb" } } }),
      modelTileLoader: () => new Promise(r => { resolve = r; }),
    });
    const loading = google.load();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    google.dispose(); resolve({ asset, attributions: [] });
    expect(await loading).toEqual([]);
    expect(disposed).toHaveBeenCalledOnce();
    scene.dispose(); engine.dispose();
  });

  it("inherits additive refinement and respects the model budget", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const google = new Google3DTiles(tileSet, { apiKey: "test-key", maxTiles: 2,
      tilesetLoader: async () => ({ root: { refine: "ADD", children: [{
        content: { uri: "parent.glb" }, children: [{ content: { uri: "child.glb" } }],
      }] } }), modelTileLoader: createModelLoader([]),
    });
    expect((await google.load()).map(tile => new URL(tile.url).pathname.split("/").pop())).toEqual(["child.glb", "parent.glb"]);
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it.each(["box", "sphere"])("filters transformed %s volumes outside the map", async (kind) => {
    const { engine, scene, tileSet } = createTileSet();
    tileSet.updateRaster(0, 0, 16);
    const volume = kind === "box" ? { box: [0,0,0,10,0,0,0,10,0,0,0,10] } : { sphere: [0,0,0,10] };
    const google = new Google3DTiles(tileSet, { apiKey: "test-key",
      tilesetLoader: async () => ({ root: { children: [
        { boundingVolume: volume, transform: Array.from(Matrix.Translation(-6378137,0,0).m), content: { uri: "outside.glb" } },
        { boundingVolume: volume, transform: Array.from(Matrix.Translation(6378137,0,0).m), content: { uri: "inside.glb" } },
      ] } }), modelTileLoader: createModelLoader([]),
    });
    expect((await google.load()).map(tile => new URL(tile.url).pathname.split("/").pop())).toEqual(["inside.glb"]);
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it("retries failed child tilesets on a subsequent load", async () => {
    const { engine, scene, tileSet } = createTileSet();
    let attempts = 0;
    const google = new Google3DTiles(tileSet, { apiKey: "test-key",
      tilesetLoader: async (url) => {
        if (url.includes("root.json")) return { root: { content: { uri: "child.json" } } };
        if (++attempts === 1) throw new Error("Temporary failure");
        return { root: { content: { uri: "model.glb" } } };
      }, modelTileLoader: createModelLoader([]),
    });
    expect(await google.load()).toHaveLength(0);
    expect(await google.load()).toHaveLength(1);
    google.dispose(); scene.dispose(); engine.dispose();
  });
});


describe("Google3DTiles edge cases", () => {
  it.each([
    { maxDepth: -1 }, { maxDepth: 1.5 }, { maxTiles: 0 }, { maxTiles: NaN },
    { exaggeration: 0 }, { exaggeration: Infinity }, { origin: { latitude: 91, longitude: 0 } },
    { origin: { latitude: 0, longitude: 181 } }, { origin: { latitude: 0, longitude: 0, height: NaN } },
  ])("rejects invalid options %j without network requests", async (options) => {
    const { engine, scene, tileSet } = createTileSet();
    const loader = vi.fn();
    const google = new Google3DTiles(tileSet, { apiKey: "test-key", ...options, tilesetLoader: loader });
    await expect(google.load()).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
    scene.dispose(); engine.dispose();
  });

  it("selects across the antimeridian", async () => {
    const { engine, scene, tileSet } = createTileSet();
    tileSet.updateRaster(0, 180, 16);
    const google = new Google3DTiles(tileSet, { apiKey: "test-key",
      tilesetLoader: async () => ({ root: { boundingVolume: { region: [-Math.PI, -Math.PI/2, Math.PI, Math.PI/2] }, children: [
        { boundingVolume: { region: [-Math.PI, -0.01, -Math.PI + 0.01, 0.01] }, content: { uri: "dateline.glb" } },
        { boundingVolume: { region: [0, -0.01, 0.01, 0.01] }, content: { uri: "greenwich.glb" } },
      ] } }), modelTileLoader: createModelLoader([]),
    });
    expect((await google.load()).map(tile => new URL(tile.url).pathname.split("/").pop())).toEqual(["dateline.glb"]);
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it("keeps the newest load when hierarchy responses arrive out of order", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const resolvers: Array<(value: Google3DTileset) => void> = [];
    const google = new Google3DTiles(tileSet, { apiKey: "test-key",
      tilesetLoader: () => new Promise(resolve => resolvers.push(resolve)),
      modelTileLoader: createModelLoader([]),
    });
    const first = google.load();
    google.apiKey = "new-key";
    const second = google.load();
    resolvers[1]({ root: { content: { uri: "new.glb" } } });
    expect(await second).toHaveLength(1);
    resolvers[0]({ root: { content: { uri: "old.glb" } } });
    expect(await first).toEqual([]);
    expect(google.loadedModelTiles[0].url).toContain("new.glb");
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it("shares an in-flight root request across camera refreshes", async () => {
    const { engine, scene, tileSet } = createTileSet();
    let finish!: (value: Google3DTileset) => void;
    const tilesetLoader = vi.fn(() => new Promise<Google3DTileset>(resolve => { finish = resolve; }));
    const google = new Google3DTiles(tileSet, { apiKey: "test-key", tilesetLoader,
      modelTileLoader: createModelLoader([]),
    });
    const first = google.load();
    const second = google.load();
    expect(tilesetLoader).toHaveBeenCalledOnce();
    finish({ root: { content: { uri: "current.glb" } } });
    expect(await first).toEqual([]);
    expect(await second).toHaveLength(1);
    expect(google.stats.hierarchyRequests).toBe(1);
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it("inherits a response's session instead of a different branch's latest token", () => {
    const { engine, scene, tileSet } = createTileSet();
    const google = new Google3DTiles(tileSet, { apiKey: "test-key" });
    google.getTileURL("child.json?session=other");
    const url = new URL(google.getTileURL("model.glb", "https://tile.googleapis.com/v1/3dtiles/child.json?session=parent"));
    expect(url.searchParams.get("session")).toBe("parent");
    scene.dispose(); engine.dispose();
  });

  it.each([new ArrayBuffer(0), createGLB({ extensions: { CESIUM_RTC: { center: [1, 2] } } })])("handles absent or malformed RTC data", (buffer) => {
    expect(parseGoogleGLBMetadata(buffer).rtcCenter).toBeUndefined();
  });
});

it("imports an actual GLB through Babylon's default loader and disposes its meshes", async () => {
  const { engine, scene, tileSet } = createTileSet();
  // Node has Blob/File but no FileReader. Preserve the browser file-reading contract.
  const fileNames: string[] = [];
  class TestFileReader {
    public result: ArrayBuffer | undefined;
    public onload?: (event: { target: TestFileReader }) => void;
    public onloadend?: () => void;
    public readAsArrayBuffer(file: File) {
      fileNames.push(file.name);
      void file.arrayBuffer().then(buffer => {
        this.result = buffer;
        this.onload?.({ target: this });
        this.onloadend?.();
      });
    }
    public abort() {}
  }
  vi.stubGlobal("FileReader", TestFileReader);
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  const glb = createGLB({
    asset: { version: "2.0", copyright: "Integration fixture" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    extensionsUsed: ["KHR_materials_unlit"],
    materials: [{ extensions: { KHR_materials_unlit: {} } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0,0,0], max: [10,10,0] }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    buffers: [{ byteLength: positions.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString("base64")}` }],
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(glb)));
  const google = new Google3DTiles(tileSet, { apiKey: "test-key",
    tilesetLoader: async () => ({ root: {
      transform: Array.from(Matrix.Translation(6378137, 0, 0).m), contents: [{ uri: "model.glb" }, { uri: "second.glb" }],
    } }),
  });
  try {
    const [loaded] = await google.load();
    expect(loaded).toBeDefined();
    expect(fileNames).toHaveLength(0); // Binary loading no longer copies through File/FileReader.
    expect(google.loadedModelTiles).toHaveLength(2);
    expect(loaded.asset.meshes.some(mesh => mesh.getTotalVertices() === 3)).toBe(true);
    expect(google.getAttributions()).toEqual(["Integration fixture"]);
    expect((loaded.asset.materials[0] as { unlit?: boolean }).unlit).toBe(true);
    const mesh = loaded.asset.meshes.find(mesh => mesh.getTotalVertices() === 3)!;
    const point = Vector3.TransformCoordinates(new Vector3(0, 10, 0), mesh.computeWorldMatrix(true));
    const origin = tileSet.ourTileMath.EPSG_to_Game(new Vector2(0, 0), EPSG_Type.EPSG_4326);
    expect(point.x).toBeCloseTo(origin.x, 5);
    expect(point.y).toBeCloseTo(0, 5);
    expect(point.z).toBeCloseTo(origin.z + 10 * tileSet.tileScale, 5);
    const meshes = [...loaded.asset.meshes];
    google.dispose();
    expect(meshes.every(mesh => mesh.isDisposed())).toBe(true);
  } finally {
    google.dispose(); scene.dispose(); engine.dispose(); vi.unstubAllGlobals();
  }
});

it.each([undefined, 1])("does not fall back to distant coarse content after all children are culled (SSE: %s)", async maximumScreenSpaceError => {
  const { engine, scene, tileSet } = createTileSet();
  tileSet.updateRaster(0, 0, 16);
  const google = new Google3DTiles(tileSet, { apiKey: "test-key", maximumScreenSpaceError,
    tilesetLoader: async () => ({ root: {
      boundingVolume: { region: [-Math.PI, -Math.PI / 2, Math.PI, Math.PI / 2] },
      content: { uri: "coarse.glb" },
      children: [{ boundingVolume: { region: [1, 0, 2, 1] }, content: { uri: "outside.glb" } }],
    } }), modelTileLoader: createModelLoader([]),
  });
  expect(await google.load()).toHaveLength(0);
  google.dispose(); scene.dispose(); engine.dispose();
});


describe("Google tiles on a globe", () => {
  it.each([[0, 0], [36, -78], [-45, 179]])("preserves radial height and metre scale at %s, %s without adding DEM height", async (latitude, longitude) => {
    const engine = new NullEngine();
    PerformanceConfigurator.SetMatrixPrecision(true);
    const scene = new Scene(engine);
    const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
    globe.createGeometry(new Vector2(1, 1), 20, 2);
    globe.updateRaster(latitude, longitude, 17);
    vi.spyOn(globe, "sampleElevation").mockReturnValue(100);
    const angle = latitude * Math.PI / 180;
    const e2 = 6.69437999014e-3;
    const n = 6378137 / Math.sqrt(1 - e2 * Math.sin(angle) ** 2);
    const lon = longitude * Math.PI / 180;
    const rtc = new Vector3((n + 120) * Math.cos(angle) * Math.cos(lon), (n + 120) * Math.cos(angle) * Math.sin(lon), (n * (1 - e2) + 120) * Math.sin(angle));
    const provider = new Google3DTiles(globe, {
      apiKey: "test",
      tilesetLoader: async () => ({ root: { content: { uri: "chapel.glb" } } }),
      modelTileLoader: async () => ({ asset: new AssetContainer(scene), attributions: [], rtcCenter: rtc }),
    });
    const [tile] = await provider.load();
    const world = tile.root.computeWorldMatrix(true);
    const position = Vector3.TransformCoordinates(Vector3.Zero(), world);
    expect(Vector3.Distance(position, globe.getSurfacePosition(latitude, longitude, 120 * globe.metresToWorld))).toBeLessThan(globe.metresToWorld);
    const metre = Vector3.TransformNormal(new Vector3(1, 0, 0), world).length();
    expect(metre).toBeCloseTo(globe.metresToWorld, 12);
    provider.heightOffset = 32;
    const [shifted] = await provider.load();
    const shiftedPosition = Vector3.TransformCoordinates(Vector3.Zero(), shifted.root.computeWorldMatrix(true));
    expect(Vector3.Distance(shiftedPosition, globe.getSurfacePosition(latitude, longitude, 152 * globe.metresToWorld))).toBeLessThan(globe.metresToWorld);
    provider.dispose();
    expect(tile.root.isDisposed()).toBe(true);
    scene.dispose(); engine.dispose();
  });
});


it("refines visible Google geometry as its projected error grows", async () => {
  const engine = new NullEngine({ renderWidth: 1000, renderHeight: 1000, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
  const scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2);
  globe.updateRaster(0, 0, 17);
  const target = globe.getSurfacePosition(0, 0);
  const camera = new ArcRotateCamera("view", 0, 1, 1, target, scene);
  const bounds = { sphere: [6378137, 0, 0, 10] };
  const provider = new Google3DTiles(globe, { apiKey: "test", maximumScreenSpaceError: 1,
    tilesetLoader: async () => ({ root: { boundingVolume: { box: [0, 0, 0, 7645212, 0, 0, 0, 7645212, 0, 0, 0, 7645212] }, geometricError: 1e100, children: [{ boundingVolume: bounds, geometricError: 1, content: { uri: "coarse.glb" },
      children: [{ boundingVolume: bounds, geometricError: 0, content: { uri: "fine.glb" } }] }] } }),
    modelTileLoader: createModelLoader([]) });
  camera.setPosition(globe.getSurfacePosition(0, 0, 10000 * globe.metresToWorld));
  camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  expect((await provider.load())[0].url).toContain("coarse.glb");
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  expect((await provider.load())[0].url).toContain("fine.glb");
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("keeps complete sibling coverage when refinement reaches the tile budget", async () => {
  const {engine, scene, tileSet} = createTileSet();
  const provider = new Google3DTiles(tileSet, {apiKey:"test", maximumScreenSpaceError:1, maxTiles:3,
    tilesetLoader:async () => ({root:{children:[
      {content:{uri:"west.glb"},children:[{content:{uri:"west-1.glb"}},{content:{uri:"west-2.glb"}}]},
      {content:{uri:"east.glb"},children:[{content:{uri:"east-1.glb"}},{content:{uri:"east-2.glb"}}]},
    ]}}), modelTileLoader:createModelLoader([])});
  const tiles = await provider.load();
  expect(tiles).toHaveLength(3);
  expect(provider.stats.modelRequests).toBe(3);
  expect(provider.stats.detailLimitedTiles).toBe(1);
  expect(tiles.some(tile => tile.url.includes("west"))).toBe(true);
  expect(tiles.some(tile => tile.url.includes("east"))).toBe(true);
  expect(tiles.filter(tile => /west-/.test(tile.url))).toHaveLength(2);
  expect(tiles.some(tile => tile.url.includes("east.glb"))).toBe(true);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("replaces a parent only after the complete child batch is ready", async () => {
  const {engine, scene, tileSet} = createTileSet();
  let finish!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => {started=resolve;});
  const slow = new Promise<void>(resolve => {finish=resolve;});
  const provider = new Google3DTiles(tileSet,{apiKey:"test",maximumScreenSpaceError:1,maxDepth:0,
    tilesetLoader:async () => ({root:{content:{uri:"parent.glb"},children:[{content:{uri:"fast.glb"}},{content:{uri:"slow.glb"}}]}}),
    modelTileLoader:async url => {
      if(url.includes("slow.glb")) {started(); await slow;}
      return {asset:new AssetContainer(scene),attributions:[]};
    }});
  const [parent]=await provider.load();
  provider.maxDepth=4;
  const replacement=provider.load(); await waiting;
  expect(parent.root.isEnabled()).toBe(true);
  expect(provider.loadedModelTiles.map(tile=>tile.url)).toEqual([parent.url]);
  finish(); await replacement;
  expect(parent.root.isEnabled()).toBe(false);
  expect(provider.stats.modelRequests).toBe(3);
  expect(provider.loadedModelTiles).toHaveLength(2);
  expect(provider.loadedModelTiles.every(tile=>tile.root.isEnabled())).toBe(true);
  provider.dispose();scene.dispose();engine.dispose();
});

it("keeps the parent when a replacement batch becomes stale while loading", async () => {
  const { engine, scene, tileSet } = createTileSet();
  let releaseSlow!: () => void;
  let startedSlow!: () => void;
  const slowStarted = new Promise<void>(resolve => { startedSlow = resolve; });
  const slow = new Promise<void>(resolve => { releaseSlow = resolve; });
  const provider = new Google3DTiles(tileSet, { apiKey: "test", modelTileLoader: async url => {
    if (url === "slow.glb") { startedSlow(); await slow; }
    return { asset: new AssetContainer(scene), attributions: [] };
  } }) as any;
  const origin = provider.getOrigin();
  provider.originStateKey = provider.getOriginStateKey(origin);
  const parent = { url: "parent.glb", depth: 1, ancestors: [], refine: "REPLACE" };
  const fast = { url: "fast.glb", depth: 2, ancestors: [parent.url], refine: "REPLACE" };
  const delayed = { url: "slow.glb", depth: 2, ancestors: [parent.url], refine: "REPLACE" };
  const parentRoot = new TransformNode("visible parent", scene);
  provider.loadedTiles.set(parent.url, { url: parent.url, root: parentRoot,
    asset: new AssetContainer(scene), attributions: [] });
  provider.loadedSelections.set(parent.url, parent);
  const desired = new Map([[fast.url, fast], [delayed.url, delayed]]);
  provider.desiredTiles = desired;
  try {
    const replacement = provider.loadReplacementGroups(desired, origin, provider.generation);
    await slowStarted;
    await vi.waitFor(() => expect(provider.retainedTiles.has(fast.url)).toBe(true));
    desired.delete(fast.url);
    releaseSlow();
    await replacement;
    expect(parentRoot.isEnabled()).toBe(true);
    expect(provider.loadedTiles.has(parent.url)).toBe(true);
    expect(provider.loadedTiles.has(fast.url)).toBe(false);
    expect(provider.loadedTiles.has(delayed.url)).toBe(false);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it.each(["parent.glb", "child.glb"])("never draws overlapping Google levels when %s finishes first", async first => {
  const { engine, scene, tileSet } = createTileSet();
  const completions = new Map<string, () => void>();
  const provider = new Google3DTiles(tileSet, { apiKey: "test",
    modelTileLoader: url => new Promise(resolve => completions.set(url, () => resolve({
      asset: new AssetContainer(scene), attributions: [],
    }))),
  }) as any;
  const origin = provider.getOrigin();
  provider.originStateKey = provider.getOriginStateKey(origin);
  const parent = { url: "parent.glb", depth: 1, ancestors: [] };
  const child = { url: "child.glb", depth: 2, ancestors: [parent.url] };
  provider.desiredTiles.set(parent.url, parent);
  provider.desiredTiles.set(child.url, child);
  try {
    const loading = [provider.loadTile(parent, origin, provider.generation),
      provider.loadTile(child, origin, provider.generation)];
    await vi.waitFor(() => expect(completions.size).toBe(2));
    completions.get(first)!();
    await vi.waitFor(() => expect(provider.loadedModelTiles).toHaveLength(1));
    const second = first === parent.url ? child.url : parent.url;
    completions.get(second)!();
    await Promise.all(loading);
    expect(provider.loadedModelTiles).toHaveLength(1);
    expect(provider.loadedModelTiles[0].url).toBe(first);
    expect(provider.retainedTiles.has(second)).toBe(true);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it.each(["parent.glb", "child.glb"])("keeps cached %s hidden while its replacement level is visible", async cached => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet, { apiKey: "test" }) as any;
  const origin = provider.getOrigin();
  const parent = { url: "parent.glb", depth: 1, ancestors: [], refine: "REPLACE" };
  const child = { url: "child.glb", depth: 2, ancestors: [parent.url], refine: "REPLACE" };
  const cachedSelection = cached === parent.url ? parent : child;
  const visibleSelection = cached === parent.url ? child : parent;
  const cachedRoot = new TransformNode("cached", scene);
  const visibleRoot = new TransformNode("visible", scene);
  cachedRoot.setEnabled(false);
  provider.retainedTiles.set(cached, { url: cached, root: cachedRoot,
    asset: new AssetContainer(scene), attributions: [] });
  provider.loadedSelections.set(cached, cachedSelection);
  provider.loadedTiles.set(visibleSelection.url, { url: visibleSelection.url, root: visibleRoot,
    asset: new AssetContainer(scene), attributions: [] });
  provider.loadedSelections.set(visibleSelection.url, visibleSelection);
  try {
    await provider.loadTile(cachedSelection, origin, provider.generation);
    expect(cachedRoot.isEnabled()).toBe(false);
    expect(visibleRoot.isEnabled()).toBe(true);
    expect(provider.retainedTiles.has(cached)).toBe(true);
    expect(provider.loadedTiles.has(cached)).toBe(false);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("does not promote a cached parent after its finer child becomes resident during selection", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet, { apiKey: "test", maximumScreenSpaceError: 1,
    tilesetLoader: async () => ({ root: {} }), modelTileLoader: createModelLoader([]),
  }) as any;
  const parentRoot = new TransformNode("cached parent", scene);
  const childRoot = new TransformNode("new child", scene);
  parentRoot.setEnabled(false);
  const parent = { url: "parent.glb", depth: 1, ancestors: [], refine: "REPLACE" };
  const child = { url: "child.glb", depth: 2, ancestors: [parent.url], refine: "REPLACE" };
  let parentEnabledDuringSelection = false;
  vi.spyOn(provider, "selectFrontier").mockImplementation(async (_desired, _generation, onStable) => {
    provider.retainedTiles.set(parent.url, { url: parent.url, root: parentRoot,
      asset: new AssetContainer(scene), attributions: [] });
    provider.loadedSelections.set(parent.url, parent);
    provider.loadedTiles.set(child.url, { url: child.url, root: childRoot,
      asset: new AssetContainer(scene), attributions: [] });
    provider.loadedSelections.set(child.url, child);
    onStable(child);
    parentEnabledDuringSelection = parentRoot.isEnabled();
  });
  try {
    await provider.load();
    expect(parentEnabledDuringSelection).toBe(false);
    expect(childRoot.isEnabled()).toBe(true);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("removes an interim REPLACE parent from demand when its child frontier arrives", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet, { apiKey: "test", maximumScreenSpaceError: 1 }) as any;
  provider.rootTileset = { root: { geometricError: 100, content: { uri: "parent.glb" },
    children: [{ geometricError: 0, content: { uri: "child.glb" } }] } };
  const parent = provider.getTileURL("parent.glb");
  const child = provider.getTileURL("child.glb");
  const desired = new Map([[parent, { url: parent, depth: 0 }]]);
  try {
    await provider.selectFrontier(desired, provider.generation, () => {});
    expect(desired.has(parent)).toBe(false);
    expect(desired.has(child)).toBe(true);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("retains parent coverage when a replacement model fails", async () => {
  const {engine, scene, tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet,{apiKey:"test",maximumScreenSpaceError:1,maxDepth:0,
    tilesetLoader:async()=>({root:{content:{uri:"parent.glb"},children:[{content:{uri:"failed.glb"}}]}}),
    modelTileLoader:async url=>url.includes("failed")?undefined:{asset:new AssetContainer(scene),attributions:[]}});
  const [parent]=await provider.load(); provider.maxDepth=4;
  expect(await provider.load()).toEqual([parent]);
  expect(parent.root.isEnabled()).toBe(true);
  provider.dispose();scene.dispose();engine.dispose();
});

it("keeps the visible parent when a replacement GLB has no drawable geometry", async () => {
  const {engine,scene,tileSet}=createTileSet();
  const empty=new AssetContainer(scene);
  const dispose=vi.spyOn(empty,"dispose");
  const provider=new Google3DTiles(tileSet,{apiKey:"test",maximumScreenSpaceError:1,maxDepth:0,
    tilesetLoader:async()=>({root:{content:{uri:"parent.glb"},children:[{content:{uri:"empty.glb"}}]}}),
    modelTileLoader:async url=>url.includes("empty.glb")
      ? {asset:empty,attributions:[],renderable:false}
      : {asset:new AssetContainer(scene),attributions:[],renderable:true}});
  const [parent]=await provider.load();
  provider.maxDepth=4;
  expect(await provider.load()).toEqual([parent]);
  expect(parent.root.isEnabled()).toBe(true);
  expect(dispose).toHaveBeenCalledOnce();
  provider.dispose();scene.dispose();engine.dispose();
});

it("keeps a coarse Google fallback visible when the tile budget prevents refinement", async () => {
  const {engine, scene, tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet,{apiKey:"test",maximumScreenSpaceError:1,maximumDisplayGeometricError:4,maxTiles:2,
    tilesetLoader:async()=>({root:{children:[
      {geometricError:1,content:{uri:"sharp.glb"}},
      {geometricError:64,content:{uri:"distorted.glb"},children:[{content:{uri:"fine-a.glb"}},{content:{uri:"fine-b.glb"}}]},
    ]}}),modelTileLoader:createModelLoader([])});
  const tiles=await provider.load();
  expect(tiles.map(tile=>tile.url)).toEqual(expect.arrayContaining([
    expect.stringContaining("sharp.glb"), expect.stringContaining("distorted.glb"),
  ]));
  expect(provider.stats.modelRequests).toBe(2);
  provider.dispose();scene.dispose();engine.dispose();
});

it("renders the best available Google leaf even when its source error exceeds the display target", async () => {
  const {engine, scene, tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet,{apiKey:"test",maximumScreenSpaceError:1,maximumDisplayGeometricError:4,maxTiles:8,
    tilesetLoader:async()=>({root:{geometricError:64,content:{uri:"source-leaf.glb"}}}),
    modelTileLoader:createModelLoader([])});
  const tiles=await provider.load();
  expect(tiles.map(tile=>tile.url)).toEqual([expect.stringContaining("source-leaf.glb")]);
  provider.dispose();scene.dispose();engine.dispose();
});

it("reuses a stable budget frontier without additional model requests", async () => {
  const {engine, scene, tileSet} = createTileSet();
  const requests: string[] = [];
  const provider = new Google3DTiles(tileSet, {apiKey:"test",maximumScreenSpaceError:1,maxTiles:3,
    tilesetLoader:async()=>({root:{children:[
      {content:{uri:"a.glb"},children:[{content:{uri:"a1.glb"}},{content:{uri:"a2.glb"}}]},
      {content:{uri:"b.glb"},children:[{content:{uri:"b1.glb"}},{content:{uri:"b2.glb"}}]},
    ]}}),modelTileLoader:createModelLoader(requests)});
  const first = await provider.load();
  const count = requests.length;
  const coverageRevision = provider.coverageRevision;
  expect(await provider.load()).toEqual(first);
  expect(requests).toHaveLength(count);
  expect(provider.coverageRevision).toBe(coverageRevision);
  provider.dispose();scene.dispose();engine.dispose();
});

it("shares an in-flight model across camera reloads", async () => {
  const {engine, scene, tileSet} = createTileSet();
  let release!: () => void, started!: () => void;
  const start = new Promise<void>(resolve => {started=resolve;});
  const wait = new Promise<void>(resolve => {release=resolve;});
  let requests=0;
  const provider=new Google3DTiles(tileSet,{apiKey:"test",maximumScreenSpaceError:1,
    tilesetLoader:async()=>({root:{content:{uri:"shared.glb"}}}),
    modelTileLoader:async()=>{requests++;started();await wait;return {asset:new AssetContainer(scene),attributions:[]};}});
  const first=provider.load();await start;
  provider.cancelPendingLoad();
  const second=provider.load();
  release();await Promise.all([first,second]);
  expect(requests).toBe(1);
  expect(provider.loadedModelTiles).toHaveLength(1);
  expect(provider.loadedModelTiles[0].root.isEnabled()).toBe(true);
  provider.dispose();scene.dispose();engine.dispose();
});

it("reuses a queued hierarchy request after the camera selection changes", async () => {
  const {engine, scene, tileSet} = createTileSet();
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  let requests = 0;
  const provider = new Google3DTiles(tileSet, {apiKey: "test",
    tilesetLoader: async () => { requests++; await waiting; return {root: {}}; }});
  const first = (provider as any).loadExternalTileset("child.json", "https://example.com/root.json");
  provider.cancelPendingLoad();
  const second = (provider as any).loadExternalTileset("child.json", "https://example.com/root.json");
  finish();
  expect(await second).toEqual(await first);
  expect(requests).toBe(1);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("preserves visible detail when a reduced budget cannot replace it adequately", async () => {
  const {engine, scene, tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet,{apiKey:"test",maximumScreenSpaceError:1,maxTiles:4,
    tilesetLoader:async()=>({root:{geometricError:100,content:{uri:"coarse.glb"},children:[
      {content:{uri:"fine-a.glb"}},{content:{uri:"fine-b.glb"}},
    ]}}),modelTileLoader:createModelLoader([])});
  const first=await provider.load();
  provider.maxTiles=1;
  expect(await provider.load()).toEqual(first);
  expect(first.every(tile=>tile.root.isEnabled())).toBe(true);
  expect(provider.stats.modelRequests).toBe(2);
  provider.dispose();scene.dispose();engine.dispose();
});

it("loads from the eye outward even when the orbit target is elsewhere", async () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const globe=new GlobeSet(scene,engine,{radius:60,attribution:false});
  globe.createGeometry(new Vector2(1,1),20,2);globe.updateRaster(0,0,12);
  const camera=new ArcRotateCamera("eye",0,1,1,globe.getSurfacePosition(0,0.05),scene);
  camera.setPosition(globe.getSurfacePosition(0,0,100*globe.metresToWorld));
  camera.getViewMatrix(true);
  const requests:string[]=[];
  const angle=0.05*Math.PI/180;
  const provider=new Google3DTiles(globe,{apiKey:"test",maximumScreenSpaceError:1,maxTiles:2,coverageRadius:10000,
    tilesetLoader:async()=>({root:{children:[
      {boundingVolume:{sphere:[6378137*Math.cos(angle),6378137*Math.sin(angle),0,10]},content:{uri:"target.glb"}},
      {boundingVolume:{sphere:[6378137,0,0,10]},content:{uri:"eye.glb"}},
    ]}}),modelTileLoader:createModelLoader(requests)});
  await provider.load();expect(requests).toHaveLength(2);expect(requests[0]).toContain("eye.glb");
  provider.dispose();scene.dispose();engine.dispose();
});

it("centers the coverage radius on the viewer when the orbit target is elsewhere", () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(0, 0), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0.2, 100 * globe.metresToWorld)); camera.getViewMatrix(true);
  const provider = new Google3DTiles(globe, { coverageRadius: 10000 });
  const bounds = (provider as any).getTileSetBounds();
  expect(bounds.longitudes[0][0]).toBeGreaterThan(0.1);
  expect(bounds.longitudes[0][1]).toBeLessThan(0.3);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("keeps cardinal edge tiles and skips spherical and box volumes outside the 15-mile disk", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(0, 0), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld)); camera.getViewMatrix(true);
  const ecef = (latitude: number, longitude: number) => {
    const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
    return [6378137 * Math.cos(lat) * Math.cos(lon),
      6378137 * Math.cos(lat) * Math.sin(lon), 6378137 * Math.sin(lat)];
  };
  const diagonal = ecef(0.19, 0.19);
  const requests: string[] = [];
  const provider = new Google3DTiles(globe, { apiKey: "test", coverageRadius: 15 * 1609.344,
    maxTiles: 8, tilesetLoader: async () => ({ root: { children: [
      { boundingVolume: { sphere: [...ecef(0, 0.215), 50] }, content: { uri: "edge.glb" } },
      { boundingVolume: { sphere: [...diagonal, 50] }, content: { uri: "diagonal-sphere.glb" } },
      { boundingVolume: { box: [...diagonal, 20, 0, 0, 0, 20, 0, 0, 0, 20] },
        content: { uri: "diagonal-box.glb" } },
    ] } }), modelTileLoader: createModelLoader(requests) });
  try {
    await provider.load();
    expect(requests.map(url => url.split("/").pop()?.split("?")[0])).toEqual(["edge.glb"]);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("shows nearby models before extending selection to the full coverage radius", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, {radius: 60, attribution: false});
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(0, 0), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld)); camera.getViewMatrix(true);
  const sphere = (lon: number) => { const angle = lon * Math.PI / 180;
    return {sphere: [6378137 * Math.cos(angle), 6378137 * Math.sin(angle), 0, 100]}; };
  const requests: string[] = [];
  const provider = new Google3DTiles(globe, {apiKey: "test", maximumScreenSpaceError: 1,
    coverageRadius: 15 * 1609.344, tilesetLoader: async () => ({root: {children: [
      {boundingVolume: sphere(0), geometricError: 0, content: {uri: "near.glb"}},
      {boundingVolume: sphere(0.1), geometricError: 0, content: {uri: "far.glb"}},
    ]}}), modelTileLoader: createModelLoader(requests)});
  try {
    const nearby = await provider.load(3000);
    expect(nearby.map(tile => tile.url)).toEqual([expect.stringContaining("near.glb")]);
    const full = await provider.load();
    expect(full.map(tile => tile.url)).toEqual(expect.arrayContaining([
      expect.stringContaining("near.glb"), expect.stringContaining("far.glb")]));
    expect(requests).toHaveLength(2);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("starts visible work immediately while the full-radius queue is saturated", async () => {
  const {engine,scene,tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet);
  const releases: Array<()=>void>=[];
  const background=Array.from({length:48},()=> (provider as any).networkSlot(
    ()=>new Promise<void>(resolve=>{releases.push(resolve);}),1e9));
  try {
    await vi.waitFor(()=>expect(releases).toHaveLength(46));
    const visibleStarted=vi.fn();
    const visible=(provider as any).networkSlot(async()=>{visibleStarted();},-1);
    await vi.waitFor(()=>expect(visibleStarted).toHaveBeenCalledOnce());
    expect(releases).toHaveLength(46);
    for (const release of releases) release();
    await vi.waitFor(()=>expect(releases).toHaveLength(48));
    releases[46]();releases[47]();
    await Promise.all([...background,visible]);
  } finally { provider.dispose();scene.dispose();engine.dispose(); }
});

it("cancels an active model fetch after Shift movement leaves it outside the full disk", async () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const globe=new GlobeSet(scene,engine,{radius:60,attribution:false});
  globe.createGeometry(new Vector2(1,1),20,2);globe.updateRaster(0,0,12);
  const camera=new ArcRotateCamera("eye",0,1,1,globe.getSurfacePosition(0,0),scene);
  camera.setPosition(globe.getSurfacePosition(0,0,100*globe.metresToWorld));camera.getViewMatrix(true);
  let activeSignal:AbortSignal|undefined;
  const provider=new Google3DTiles(globe,{apiKey:"test",coverageRadius:1000,maxDepth:0,
    maximumScreenSpaceError:1,tilesetLoader:async()=>({root:{
      boundingVolume:{sphere:[6378137,0,0,100]},geometricError:0,content:{uri:"old.glb"}}}),
    modelTileLoader:async (_url,_scene,signal)=>{
      activeSignal=signal;
      return new Promise((_resolve,reject)=>signal!.addEventListener("abort",()=>reject(signal!.reason),{once:true}));
    }});
  try {
    const loading=provider.load();
    await vi.waitFor(()=>expect(activeSignal).toBeDefined());
    camera.setPosition(globe.getSurfacePosition(0,0.003,100*globe.metresToWorld));camera.getViewMatrix(true);
    provider.reprioritizeRequests();
    expect(activeSignal!.aborted).toBe(false);
    camera.setPosition(globe.getSurfacePosition(0,0.04,100*globe.metresToWorld));camera.getViewMatrix(true);
    provider.reprioritizeRequests();
    await vi.waitFor(()=>expect(activeSignal!.aborted).toBe(true));
    await loading;
    expect(provider.loadedModelTiles).toHaveLength(0);
  } finally {provider.dispose();scene.dispose();engine.dispose();}
});

it("commits nearby refinement without waiting for unrelated distant hierarchy", async () => {
  const {engine,scene,tileSet}=createTileSet();
  let release!:()=>void, reached!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const waiting=new Promise<void>(resolve=>{reached=resolve;});
  const provider=new Google3DTiles(tileSet,{apiKey:"test",maximumScreenSpaceError:1,maxDepth:1,
    tilesetLoader:async url=>{
      if(url.includes("far.json")){reached();await blocked;return {root:{content:{uri:"far-fine.glb"}}};}
      return {root:{children:[{content:{uri:"near.glb"},children:[{content:{uri:"near-fine.glb"}}]},
        {content:{uri:"far.glb"},children:[{content:{uri:"far.json"}}]}]}};
    },modelTileLoader:createModelLoader([])});
  const old=await provider.load();
  provider.maxDepth=8;const work=provider.load();await waiting;
  await vi.waitFor(()=>expect(provider.loadedModelTiles.some(tile=>tile.url.includes("near-fine.glb"))).toBe(true));
  expect(old.find(tile=>tile.url.includes("far.glb"))!.root.isEnabled()).toBe(true);
  release();await work;
  provider.dispose();scene.dispose();engine.dispose();
});

it("refines visible Google tiles on a cold load at the demand cap", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("look", 0, 1, 1, globe.getSurfacePosition(0, 0.01), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.minZ = 1e-7; camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  const sphere = (lon: number) => { const a = lon * Math.PI / 180;
    return { sphere: [6378137 * Math.cos(a), 6378137 * Math.sin(a), 0, 100] }; };
  const requests: string[] = [];
  const provider = new Google3DTiles(globe, { apiKey: "test", maximumScreenSpaceError: 1,
    maxTiles: 3, maxDepth: 3, cullToCamera: true, fullRadiusDemand: true, coverageRadius: 10000,
    tilesetLoader: async () => ({ root: { children: [
      { boundingVolume: sphere(0.01), geometricError: 100, content: { uri: "near.glb" }, children: [
        { boundingVolume: sphere(0.01), geometricError: 0, content: { uri: "near-a.glb" } },
        { boundingVolume: sphere(0.012), geometricError: 0, content: { uri: "near-b.glb" } },
      ] },
      { boundingVolume: sphere(-0.01), geometricError: 100, content: { uri: "far-a.glb" } },
      { boundingVolume: sphere(-0.02), geometricError: 100, content: { uri: "far-b.glb" } },
    ] } }), modelTileLoader: createModelLoader(requests) });
  try {
    await provider.load();
    expect(requests.length).toBeGreaterThanOrEqual(3);
    expect(requests.some(url => url.includes("near-a.glb"))).toBe(true);
    expect(requests.some(url => url.includes("near-b.glb"))).toBe(true);
    provider.maxDepth = 3;
    await provider.load();
    expect(requests.some(url => url.includes("near-a.glb"))).toBe(true);
    expect(requests.some(url => url.includes("near-b.glb"))).toBe(true);
    expect(provider.loadedModelTiles.some(tile => tile.url.includes("far-") && tile.root.isEnabled())).toBe(true);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("prepares offscreen content without replacing visible models", async () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const globe=new GlobeSet(scene,engine,{radius:60,attribution:false});
  globe.createGeometry(new Vector2(1,1),20,2);globe.updateRaster(0,0,12);
  const eye=globe.getSurfacePosition(0,0,100*globe.metresToWorld);
  const camera=new ArcRotateCamera("look",0,1,1,globe.getSurfacePosition(0,0.01),scene);
  camera.setPosition(eye);camera.minZ=1e-7;camera.getViewMatrix(true);camera.getProjectionMatrix(true);
  const sphere=(lon:number)=>{const a=lon*Math.PI/180;return {sphere:[6378137*Math.cos(a),6378137*Math.sin(a),0,100]};};
  const requests:string[]=[];
  const provider=new Google3DTiles(globe,{apiKey:"test",maximumScreenSpaceError:1,cullToCamera:true,coverageRadius:10000,
    tilesetLoader:async()=>({root:{children:[
      {boundingVolume:sphere(0.01),geometricError:0,content:{uri:"front.glb"}},
      {boundingVolume:sphere(-0.01),geometricError:0,content:{uri:"behind.glb"}},
    ]}}),modelTileLoader:createModelLoader(requests)});
  const before=await provider.load();expect(before).toHaveLength(1);
  const bounds = vi.spyOn(provider as any, "getTileSetBounds");
  // A loose tile volume can intersect the camera frustum even when none of
  // its model is visible. Prefetch must still prepare the unseen content.
  const geometricError = vi.spyOn(provider as any, "allowedGeometricError").mockReturnValue(1);
  await provider.prefetchSurroundings();
  geometricError.mockRestore();
  expect(bounds).toHaveBeenCalledWith(10000);
  expect(provider.loadedModelTiles).toEqual(before);
  expect(requests).toHaveLength(2);
  camera.setTarget(globe.getSurfacePosition(0,-0.01));camera.setPosition(eye);camera.getViewMatrix(true);
  await provider.load();
  expect(requests).toHaveLength(2);
  expect(before[0].root.isEnabled()).toBe(true);
  expect(provider.loadedModelTiles.some(t=>t.url.includes("behind.glb"))).toBe(true);
  provider.dispose();scene.dispose();engine.dispose();
});

it("demands offscreen models in the same full-radius queue as visible models", async () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const globe=new GlobeSet(scene,engine,{radius:60,attribution:false});
  globe.createGeometry(new Vector2(1,1),20,2);globe.updateRaster(0,0,12);
  const eye=globe.getSurfacePosition(0,0,100*globe.metresToWorld);
  const camera=new ArcRotateCamera("look",0,1,1,globe.getSurfacePosition(0,0.01),scene);
  camera.setPosition(eye);camera.minZ=1e-7;camera.getViewMatrix(true);camera.getProjectionMatrix(true);
  const sphere=(lon:number)=>{const a=lon*Math.PI/180;return {sphere:[6378137*Math.cos(a),6378137*Math.sin(a),0,100]};};
  const requests:string[]=[];
  const provider=new Google3DTiles(globe,{apiKey:"test",maximumScreenSpaceError:1,cullToCamera:true,
    fullRadiusDemand:true,referenceImageHeight:2160,referenceFovY:0.8,coverageRadius:10000,maxTiles:8,
    tilesetLoader:async()=>({root:{children:[
      {boundingVolume:sphere(0.01),geometricError:128,content:{uri:"front.glb"}},
      {boundingVolume:sphere(-0.01),geometricError:128,content:{uri:"behind.glb"}},
    ]}}),modelTileLoader:createModelLoader(requests)});
  try {
    const projected=(provider as any).allowedGeometricError(sphere(0.01),Matrix.Identity());
    engine.setSize(1920,1080);
    expect((provider as any).allowedGeometricError(sphere(0.01),Matrix.Identity())).toBeCloseTo(projected);
    const loaded=await provider.load();
    expect(loaded.map(tile=>tile.url)).toEqual(expect.arrayContaining([
      expect.stringContaining("front.glb"),expect.stringContaining("behind.glb")]));
    expect(requests).toHaveLength(2);
    expect(provider.stats.visibleSourceLimitedTiles).toBe(1);
    expect(provider.stats.offscreenSourceLimitedTiles).toBe(1);
  } finally {provider.dispose();scene.dispose();engine.dispose();}
});

it("reprioritizes unexpanded hierarchy toward the moving camera", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("moving", 0, 1, 1, globe.getSurfacePosition(0, 0.001), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.getViewMatrix(true);
  const sphere = (index: number) => { const longitude = index * 0.001 * Math.PI / 180;
    return { sphere: [6378137 * Math.cos(longitude), 6378137 * Math.sin(longitude), 0, 100] }; };
  const started: number[] = [], releases: Array<() => void> = [];
  let unblock = false;
  const provider = new Google3DTiles(globe, { apiKey: "test", maximumScreenSpaceError: 1,
    fullRadiusDemand: true, coverageRadius: 10000, maxDepth: 3, maxTiles: 64,
    tilesetLoader: async url => {
      const match = url.match(/part-(\d+)\.json/);
      if (!match) return { root: { children: Array.from({ length: 20 }, (_, i) => ({
        boundingVolume: sphere(i), geometricError: 100,
        contents: [{ uri: `coarse-${i}.glb` }, { uri: `part-${i}.json` }],
      })) } };
      const index = Number(match[1]);
      started.push(index);
      if (!unblock) await new Promise<void>(resolve => releases.push(resolve));
      return { root: { boundingVolume: sphere(index), geometricError: 0,
        content: { uri: `fine-${index}.glb` } } };
    }, modelTileLoader: createModelLoader([]),
  });
  try {
    const loading = provider.load();
    await vi.waitFor(() => expect(started).toHaveLength(16));
    expect(provider.selectingFrontier).toBe(true);
    camera.setPosition(globe.getSurfacePosition(0, 0.019, 100 * globe.metresToWorld));
    camera.getViewMatrix(true);
    provider.reprioritizeRequests();
    releases[0]();
    await vi.waitFor(() => expect(started).toHaveLength(17));
    expect(started[16]).toBe(19);
    unblock = true;
    releases.slice(1).forEach(release => release());
    await loading;
    expect(provider.selectingFrontier).toBe(false);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("admits a new geographic branch while a moving disk selection is in flight", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("moving-disk", 0, 1, 1, globe.getSurfacePosition(0, 0), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.getViewMatrix(true);
  const region = (west: number, east: number) =>
    ({ region: [west * Math.PI / 180, -0.01, east * Math.PI / 180, 0.01, -100, 1000] });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let releaseRight!: () => void;
  const rightHeld = new Promise<void>(resolve => { releaseRight = resolve; });
  let holdRequests = 0;
  let rightRequests = 0;
  const models: string[] = [];
  const modelLoader = createModelLoader(models);
  const provider = new Google3DTiles(globe, {
    apiKey: "test", maximumScreenSpaceError: 1, fullRadiusDemand: true,
    coverageRadius: 10000, maxTiles: 16,
    tilesetLoader: async url => {
      if (url.includes("hold.json")) {
        holdRequests++;
        await held;
        return { root: { boundingVolume: region(-0.05, 0.3) } };
      }
      return { root: { boundingVolume: region(-0.05, 0.3), geometricError: 100,
        contents: [{ uri: "parent.glb" }, { uri: "hold.json" }],
        children: [
          { boundingVolume: region(-0.01, 0.01), geometricError: 0, content: { uri: "left.glb" } },
          { boundingVolume: region(0.24, 0.26), geometricError: 0, content: { uri: "right.glb" } },
        ],
      } };
    }, modelTileLoader: async (url, modelScene) => {
      if (url.includes("right.glb")) { rightRequests++; await rightHeld; }
      return modelLoader(url, modelScene);
    },
  });
  const oldRoot = { setEnabled: vi.fn(), dispose: vi.fn() };
  (provider as any).loadedSelections.set("old", {
    url: "old", depth: 1, boundingVolume: region(-0.01, 0.01),
  });
  (provider as any).loadedTiles.set("old", {
    url: "old", depth: 1, root: oldRoot, asset: { dispose: vi.fn() }, attributions: [],
  });
  try {
    const loading = provider.load();
    await vi.waitFor(() => expect(holdRequests).toBe(1));
    // A held hierarchy request must not pin the moving disk after several
    // successive Shift-speed displacements.
    for (const longitude of [0.003, 0.05, 0.10, 0.15, 0.20]) {
      camera.setPosition(globe.getSurfacePosition(0, longitude, 100 * globe.metresToWorld));
      camera.getViewMatrix(true);
      provider.reprioritizeRequests();
      await vi.waitFor(() => expect(provider.selectedCoverageCenter?.longitude).toBeCloseTo(longitude, 3));
    }
    camera.setPosition(globe.getSurfacePosition(0, 0.25, 100 * globe.metresToWorld));
    camera.getViewMatrix(true);
    provider.reprioritizeRequests();
    release();
    await vi.waitFor(() => expect(rightRequests).toBe(1));
    // Content beyond the moving disk can leave before the new side finishes.
    expect(oldRoot.setEnabled).toHaveBeenCalledWith(false);
    releaseRight();
    const loaded = await loading;
    expect(loaded.map(tile => tile.url)).toEqual(expect.arrayContaining([expect.stringContaining("right.glb")]));
    expect(models.some(url => url.includes("right.glb"))).toBe(true);
    expect(provider.selectedCoverageCenter?.longitude).toBeCloseTo(0.25, 2);
  } finally { release(); releaseRight(); provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("retains coarse unseen models across the configured fifteen-mile radius", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, {radius: 60, attribution: false});
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("look", 0, 1, 1, globe.getSurfacePosition(0, 0.01), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.minZ = 1e-7; camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  const sphere = (lon: number) => { const angle = lon * Math.PI / 180;
    return {sphere: [6378137 * Math.cos(angle), 6378137 * Math.sin(angle), 0, 100]}; };
  const requests: string[] = [];
  const provider = new Google3DTiles(globe, {apiKey: "test", maximumScreenSpaceError: 4,
    maximumDisplayGeometricError: 33, cullToCamera: true, coverageRadius: 15 * 1609.344,
    tilesetLoader: async () => ({root: {children: [
      {boundingVolume: sphere(0.01), geometricError: 0, content: {uri: "near.glb"}},
      {boundingVolume: sphere(0.21), geometricError: 128, content: {uri: "far.glb"}},
    ]}}), modelTileLoader: createModelLoader(requests)});
  try {
    await provider.load(3000);
    await provider.prefetchSurroundings();
    expect(requests.some(url => url.includes("far.glb"))).toBe(true);
    expect(Array.from((provider as any).retainedTiles.keys()).some((url: string) => url.includes("far.glb"))).toBe(true);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("spreads nearby prefetch across turn directions when one sector has many tiles", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const eye = globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld);
  const camera = new ArcRotateCamera("look", 0, 1, 1, globe.getSurfacePosition(0, 0.01), scene);
  camera.setPosition(eye); camera.minZ = 1e-7; camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  const sphere = (lat: number, lon: number) => {
    const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
    return { sphere: [6378137 * Math.cos(a) * Math.cos(b), 6378137 * Math.cos(a) * Math.sin(b), 6378137 * Math.sin(a), 30] };
  };
  const requests: string[] = [];
  const provider = new Google3DTiles(globe, { apiKey: "test", maximumScreenSpaceError: 1,
    cullToCamera: true, coverageRadius: 10000, maxTiles: 512,
    tilesetLoader: async () => ({ root: { children: [
      ...Array.from({ length: 260 }, (_, i) => ({ boundingVolume: sphere(i * 0.000001, -0.01),
        geometricError: 0, content: { uri: `west-${i}.glb` } })),
      { boundingVolume: sphere(0.02, -0.01), geometricError: 0, content: { uri: "north.glb" } },
    ] } }), modelTileLoader: createModelLoader(requests) });
  try {
    await provider.load();
    await provider.prefetchSurroundings();
    expect(requests.length).toBeGreaterThan(256);
    expect(requests.length).toBeLessThanOrEqual(512);
    expect(requests.some(url => url.includes("north.glb"))).toBe(true);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("shows a prefetched coarse tile during a turn until its finer replacement is ready", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const eye = globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld);
  const camera = new ArcRotateCamera("look", 0, 1, 1, globe.getSurfacePosition(0, 0.01), scene);
  camera.setPosition(eye); camera.minZ = 1e-7; camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  const sphere = (lon: number) => { const a = lon * Math.PI / 180; return { sphere: [6378137 * Math.cos(a), 6378137 * Math.sin(a), 0, 100] }; };
  let releaseFine!: () => void, fineStarted!: () => void;
  const fineReady = new Promise<void>(resolve => { releaseFine = resolve; });
  const fineWaiting = new Promise<void>(resolve => { fineStarted = resolve; });
  const provider = new Google3DTiles(globe, { apiKey: "test", maximumScreenSpaceError: 1,
    cullToCamera: true, coverageRadius: 10000, maxDepth: 1,
    tilesetLoader: async () => ({ root: { children: [
      { boundingVolume: sphere(0.01), geometricError: 0, content: { uri: "front.glb" } },
      { boundingVolume: sphere(-0.01), geometricError: 128, content: { uri: "behind-coarse.glb" },
        children: [{ boundingVolume: sphere(-0.01), geometricError: 0, content: { uri: "behind-fine.glb" } }] },
    ] } }),
    modelTileLoader: async url => {
      if (url.includes("behind-fine.glb")) { fineStarted(); await fineReady; }
      return { asset: new AssetContainer(scene), attributions: [] };
    },
  });
  try {
    await provider.load();
    await provider.prefetchSurroundings();
    expect((provider as any).retainedTiles.size).toBe(1);
    provider.maxDepth = 2;
    camera.setTarget(globe.getSurfacePosition(0, -0.01)); camera.setPosition(eye); camera.getViewMatrix(true);
    const turning = provider.load();
    expect(provider.loadedModelTiles.some(tile => tile.url.includes("behind-coarse.glb") && tile.root.isEnabled())).toBe(true);
    await fineWaiting;
    expect(provider.loadedModelTiles.some(tile => tile.url.includes("behind-coarse.glb") && tile.root.isEnabled())).toBe(true);
    releaseFine(); await turning;
    expect(provider.loadedModelTiles.some(tile => tile.url.includes("behind-fine.glb") && tile.root.isEnabled())).toBe(true);
    expect(provider.loadedModelTiles.some(tile => tile.url.includes("behind-coarse.glb"))).toBe(false);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("keeps a newly reached coarse model hidden over raster terrain until detail is ready", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(0, 0), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.getViewMatrix(true);
  const provider = new Google3DTiles(globe, { apiKey: "test", coverageRadius: 1000,
    maximumScreenSpaceError: 1, maximumInitialErrorRatio: 2, maxDepth: 0,
    tilesetLoader: async () => ({ root: { boundingVolume: { sphere: [6378137, 0, 0, 1000] },
      geometricError: 16, content: { uri: "coarse.glb" },
      children: [{ boundingVolume: { sphere: [6378137, 0, 0, 100] },
        geometricError: 0, content: { uri: "fine.glb" } }] } }),
    modelTileLoader: createModelLoader([]) });
  try {
    await provider.load();
    expect(provider.loadedModelTiles).toHaveLength(0);
    expect((provider as any).retainedTiles.size).toBe(1);
    provider.maxDepth = 1;
    await provider.load();
    expect(provider.loadedModelTiles.map(tile => tile.url)).toEqual([expect.stringContaining("fine.glb")]);
    expect(provider.measureVisibleQuality().underDetailedTiles).toBe(0);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("counts visible requested models that are still missing from the scene", () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  provider.desiredTiles.set("waiting.glb", { url: "waiting.glb", depth: 4,
    boundingVolume: { region: [0.2, -0.3, 0.3, -0.2, 0, 100] }, geometricError: 4 });
  expect(provider.measureVisibleQuality()).toMatchObject({
    visibleTiles: 0, underDetailedTiles: 0, missingVisibleTiles: 1,
  });
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("detects visible ground gaps absent from stale frontier tile counts", () => {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600 }), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("ground probes", 0, 1, 1, globe.getSurfacePosition(0, 0), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  const provider = new Google3DTiles(globe, { coverageRadius: 1000, maximumScreenSpaceError: 1 }) as any;
  const selection = { url: "stale-view.glb", depth: 1, geometricError: 0,
    boundingVolume: { region: [-0.000001, -0.000001, 0.000001, 0.000001, 0, 50] } };
  provider.loadedSelections.set(selection.url, selection);
  provider.loadedTiles.set(selection.url, { url: selection.url,
    asset: new AssetContainer(scene), root: new TransformNode("resident model", scene) });
  expect(provider.measureVisibleQuality()).toMatchObject({ visibleTiles: 1, missingVisibleTiles: 0 });
  expect(provider.sampleVisibleSurfaceCoverage()).toMatchObject({ sampled: 6, missing: 5 });
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("shows a city-block model despite a pessimistic source geometric error", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(0, 0), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.getViewMatrix(true);
  const provider = new Google3DTiles(globe, { apiKey: "test", coverageRadius: 1000,
    maximumScreenSpaceError: 1, maximumInitialErrorRatio: 2, maxDepth: 0,
    tilesetLoader: async () => ({ root: { boundingVolume: { sphere: [6378137, 0, 0, 100] },
      geometricError: 16, content: { uri: "block.glb" } } }),
    modelTileLoader: createModelLoader([]) });
  try {
    await provider.load();
    expect(provider.loadedModelTiles.map(tile => tile.url)).toEqual([expect.stringContaining("block.glb")]);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("holds a coarse city-block parent until its finer child is ready", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(0, 0), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.getViewMatrix(true);
  const provider = new Google3DTiles(globe, { apiKey: "test", coverageRadius: 1000,
    maximumScreenSpaceError: 1, maximumInitialErrorRatio: 2, maxDepth: 0,
    tilesetLoader: async () => ({ root: { boundingVolume: { sphere: [6378137, 0, 0, 100] },
      geometricError: 16, content: { uri: "coarse-block.glb" },
      children: [{ boundingVolume: { sphere: [6378137, 0, 0, 100] },
        geometricError: 0, content: { uri: "fine-block.glb" } }] } }),
    modelTileLoader: createModelLoader([]) });
  try {
    await provider.load();
    expect(provider.loadedModelTiles).toHaveLength(0);
    expect((provider as any).retainedTiles.size).toBe(1);
    provider.maxDepth = 1;
    await provider.load();
    expect(provider.loadedModelTiles.map(tile => tile.url)).toEqual([expect.stringContaining("fine-block.glb")]);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("keeps a half-kilometre coarse slab hidden until its smaller replacement is ready", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(0, 0), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.getViewMatrix(true);
  const provider = new Google3DTiles(globe, { apiKey: "test", coverageRadius: 1000,
    maximumScreenSpaceError: 1, maximumInitialErrorRatio: 2, maxDepth: 0,
    tilesetLoader: async () => ({ root: { boundingVolume: { sphere: [6378137, 0, 0, 450] },
      geometricError: 16, content: { uri: "slab.glb" },
      children: [{ boundingVolume: { sphere: [6378137, 0, 0, 100] },
        geometricError: 0, content: { uri: "detail.glb" } }] } }),
    modelTileLoader: createModelLoader([]) });
  try {
    await provider.load();
    expect(provider.loadedModelTiles).toHaveLength(0);
    provider.maxDepth = 1;
    await provider.load();
    expect(provider.loadedModelTiles.map(tile => tile.url)).toEqual([expect.stringContaining("detail.glb")]);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("does not promote a prefetched parent above the display quality limit", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const eye = globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld);
  const camera = new ArcRotateCamera("look", 0, 1, 1, globe.getSurfacePosition(0, 0.01), scene);
  camera.setPosition(eye); camera.minZ = 1e-7; camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  const sphere = (lon: number) => { const a = lon * Math.PI / 180; return { sphere: [6378137 * Math.cos(a), 6378137 * Math.sin(a), 0, 100] }; };
  let releaseFine!: () => void, fineStarted!: () => void;
  const fineReady = new Promise<void>(resolve => { releaseFine = resolve; });
  const fineWaiting = new Promise<void>(resolve => { fineStarted = resolve; });
  const provider = new Google3DTiles(globe, { apiKey: "test", maximumScreenSpaceError: 1,
    cullToCamera: true, coverageRadius: 10000, maxDepth: 1,
    tilesetLoader: async () => ({ root: { children: [
      { boundingVolume: sphere(0.01), geometricError: 0, content: { uri: "front.glb" } },
      { boundingVolume: sphere(-0.01), geometricError: 128, content: { uri: "behind-coarse.glb" },
        children: [{ boundingVolume: sphere(-0.01), geometricError: 0, content: { uri: "behind-fine.glb" } }] },
    ] } }),
    modelTileLoader: async url => {
      if (url.includes("behind-fine.glb")) { fineStarted(); await fineReady; }
      return { asset: new AssetContainer(scene), attributions: [] };
    },
  });
  try {
    const before = await provider.load();
    await provider.prefetchSurroundings();
    expect((provider as any).retainedTiles.size).toBe(1);
    provider.maximumDisplayGeometricError = 33;
    provider.maxDepth = 2;
    camera.setTarget(globe.getSurfacePosition(0, -0.01)); camera.setPosition(eye); camera.getViewMatrix(true);
    const turning = provider.load();
    await fineWaiting;
    expect(provider.loadedModelTiles.some(tile => tile.url.includes("behind-coarse.glb"))).toBe(false);
    expect(before[0].root.isEnabled()).toBe(true);
    releaseFine(); await turning;
    expect(provider.loadedModelTiles.some(tile => tile.url.includes("behind-fine.glb") && tile.root.isEnabled())).toBe(true);
  } finally { releaseFine(); provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("keeps usable detail across an explicit region even behind the camera", async () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const globe=new GlobeSet(scene,engine,{radius:60,attribution:false});
  globe.createGeometry(new Vector2(1,1),20,2);globe.updateRaster(0,0,12);
  const eye=globe.getSurfacePosition(0,0,100*globe.metresToWorld);
  const camera=new ArcRotateCamera("look",0,1,1,globe.getSurfacePosition(0,0.01),scene);
  camera.setPosition(eye);camera.minZ=1e-7;camera.getViewMatrix(true);camera.getProjectionMatrix(true);
  const sphere=(lon:number)=>{const a=lon*Math.PI/180;return {sphere:[6378137*Math.cos(a),6378137*Math.sin(a),0,100]};};
  const provider=new Google3DTiles(globe,{apiKey:"test",maximumScreenSpaceError:1,cullToCamera:true,coverageRadius:10000,
    maximumDisplayGeometricError:33, coverageRegion:{south:-0.01,north:0.01,west:-0.02,east:0.02},
    tilesetLoader:async()=>({root:{children:[
      {boundingVolume:sphere(0.01),geometricError:0,content:{uri:"front.glb"}},
      {boundingVolume:sphere(-0.01),geometricError:128,content:{uri:"ugly.glb"},children:[
        {boundingVolume:sphere(-0.01),geometricError:16,content:{uri:"usable-behind.glb"}}]},
    ]}}),modelTileLoader:createModelLoader([])});
  const loaded=await provider.load();
  expect(loaded.some(tile=>tile.url.includes("usable-behind"))).toBe(true);
  expect(loaded.some(tile=>tile.url.includes("ugly"))).toBe(false);
  provider.dispose();scene.dispose();engine.dispose();
});

it("refines a tile that meets screen-space error but exceeds the display quality limit", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const eye = globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld);
  const camera = new ArcRotateCamera("look", 0, 1, 1, globe.getSurfacePosition(0, 0.01), scene);
  camera.setPosition(eye); camera.minZ = 1e-7; camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  const a = 0.01 * Math.PI / 180;
  const volume = { sphere: [6378137 * Math.cos(a), 6378137 * Math.sin(a), 0, 100] };
  const requests: string[] = [];
  const provider = new Google3DTiles(globe, { apiKey: "test", maximumScreenSpaceError: 10000,
    maximumDisplayGeometricError: 33, coverageRadius: 10000,
    tilesetLoader: async () => ({ root: { children: [
      { boundingVolume: volume, geometricError: 128, content: { uri: "coarse.glb" },
        children: [{ boundingVolume: volume, geometricError: 16, content: { uri: "fine.glb" } }] },
    ] } }), modelTileLoader: createModelLoader(requests),
  });
  try {
    expect(128 / (provider as any).allowedGeometricError(volume, Matrix.Identity())).toBeLessThan(1);
    const loaded = await provider.load();
    expect(loaded.map(tile => tile.url)).toEqual([expect.stringContaining("fine.glb")]);
    expect(requests.some(url => url.includes("coarse.glb"))).toBe(false);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("bounds offscreen history without evicting the current view", () => {
  const {engine,scene,tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet,{maxTiles:1});
  const selections=new Map();
  for(const url of ["old-far","old-near","current"]) {
    const selection={url,depth:1};selections.set(url,selection);
    (provider as any).loadedSelections.set(url,selection);
    (provider as any).loadedTiles.set(url,{url,depth:1,root:new TransformNode(url,scene),asset:new AssetContainer(scene),attributions:[]});
  }
  vi.spyOn(provider as any,"allowedGeometricError").mockReturnValue(-1);
  (provider as any).trimVisibleHistory(new Map([["current",selections.get("current")]]));
  expect(provider.loadedModelTiles).toHaveLength(2);
  expect(provider.loadedModelTiles.find(tile=>tile.url==="current")?.root.isEnabled()).toBe(true);
  expect((provider as any).retainedTiles.size).toBe(1);
  provider.dispose();scene.dispose();engine.dispose();
});

it("keeps offscreen history inside the full radius while trimming tiles that leave it", () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("look", 0, 1, 1, globe.getSurfacePosition(0, 0.01), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.minZ = 1e-7; camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  const sphere = (lon: number) => { const a = lon * Math.PI / 180;
    return { sphere: [6378137 * Math.cos(a), 6378137 * Math.sin(a), 0, 100] }; };
  const provider = new Google3DTiles(globe, { maxTiles: 1, maximumScreenSpaceError: 1,
    cullToCamera: true, fullRadiusDemand: true, coverageRadius: 10000 }) as any;
  const desired = new Map();
  for (const [url, lon] of [["old-outside", -0.2], ["old-offscreen", -0.01],
    ["old-visible", 0.01], ["current", 0.012]] as const) {
    const selection = { url, depth: 1, boundingVolume: sphere(lon) };
    provider.loadedSelections.set(url, selection);
    provider.loadedTiles.set(url, { url, depth: 1, root: new TransformNode(url, scene),
      asset: new AssetContainer(scene), attributions: [] });
    if (url === "current") desired.set(url, selection);
  }
  try {
    expect(provider.allowedGeometricError(sphere(-0.01), Matrix.Identity())).toBeGreaterThan(0);
    provider.trimVisibleHistory(desired);
    expect(provider.loadedModelTiles.map((tile: { url: string }) => tile.url).sort())
      .toEqual(["current", "old-offscreen", "old-visible"]);
    expect(provider.retainedTiles.get("old-outside").root.isEnabled()).toBe(false);
  } finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});

it("reprioritizes queued network work from the current eye without restarting active requests", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  const releases: (() => void)[] = [];
  const active = Array.from({ length: 24 }, () => provider.networkSlot(() => new Promise<void>(resolve => releases.push(resolve))));
  await Promise.resolve(); await Promise.resolve();
  expect(releases).toHaveLength(24);
  const order: string[] = [];
  let eye = 0;
  const formerNear = provider.networkSlot(async () => { order.push("former near"); }, () => Math.abs(eye));
  const newlyNear = provider.networkSlot(async () => { order.push("newly near"); }, () => Math.abs(100 - eye));
  eye = 100;
  releases[0]();
  await Promise.all([formerNear, newlyNear]);
  expect(order).toEqual(["newly near", "former near"]);
  expect(releases).toHaveLength(24);
  releases.slice(1).forEach(release => release());
  await Promise.all(active);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("reprioritizes queued tile requests when the camera moves during a load", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  let eye = 0;
  vi.spyOn(provider, "cameraEye").mockImplementation(() => new Vector3(eye, 0, 0));
  provider.reprioritizeRequests();
  const releases: (() => void)[] = [];
  const active = Array.from({ length: 24 }, () => provider.networkSlot(() => new Promise<void>(resolve => releases.push(resolve))));
  await Promise.resolve(); await Promise.resolve();
  const order: string[] = [];
  const formerNear = provider.networkSlot(async () => { order.push("former near"); },
    () => provider.requestPriority({ sphere: [0, 0, 0, 0] }, Matrix.Identity()));
  const newlyNear = provider.networkSlot(async () => { order.push("newly near"); },
    () => provider.requestPriority({ sphere: [100, 0, 0, 0] }, Matrix.Identity()));
  eye = 100;
  provider.reprioritizeRequests();
  releases[0]();
  await Promise.all([formerNear, newlyNear]);
  expect(order).toEqual(["newly near", "former near"]);
  releases.slice(1).forEach(release => release());
  await Promise.all(active);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("releases a model download slot before its decode completes", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  let finishDecode!: () => void;
  const decoding = new Promise<void>(resolve => { finishDecode = resolve; });
  let downloadReleased = false;
  const model = provider.networkSlot(async (release: () => void) => {
    release();
    downloadReleased = true;
    await decoding;
  }, 0, "model");
  await vi.waitFor(() => expect(downloadReleased).toBe(true));
  expect(provider.networkActive).toBe(0);
  const next = vi.fn();
  await provider.networkSlot(async () => { next(); }, -1, "hierarchy");
  expect(next).toHaveBeenCalledOnce();
  finishDecode();
  await model;
  expect(provider.networkActive).toBe(0);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("frees the default loader's network slot as soon as GLB bytes arrive", async () => {
  const { engine, scene, tileSet } = createTileSet();
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, ok: true,
    arrayBuffer: async () => createGLB({ asset: { version: "2.0" } }) })));
  const provider = new Google3DTiles(tileSet, { apiKey: "test", maxDepth: 0,
    tilesetLoader: async () => ({ root: { content: { uri: "tile.glb" } } }) }) as any;
  let finishDecode!: () => void;
  const decodeReached = vi.fn();
  vi.spyOn(provider, "modelDecodeSlot").mockImplementation(() => {
    decodeReached();
    return new Promise<undefined>(resolve => { finishDecode = () => resolve(undefined); });
  });
  try {
    const loading = provider.load();
    await vi.waitFor(() => expect(decodeReached).toHaveBeenCalledOnce());
    expect(provider.networkActive).toBe(0);
    expect(provider.activeModelFetches.size).toBe(0);
    const hierarchy = vi.fn();
    await provider.networkSlot(async () => { hierarchy(); }, -1, "hierarchy");
    expect(hierarchy).toHaveBeenCalledOnce();
    finishDecode();
    await loading;
  } finally {
    provider.dispose(); scene.dispose(); engine.dispose(); vi.unstubAllGlobals();
  }
});

it("bounds pending model downloads without blocking hierarchy work", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  const releases: (() => void)[] = [];
  const active = Array.from({ length: 16 }, () => provider.networkSlot(() =>
    new Promise<void>(resolve => releases.push(resolve)), 0, "model"));
  await vi.waitFor(() => expect(releases).toHaveLength(16));
  const blockedModel = provider.networkSlot(() => new Promise<void>(resolve => releases.push(resolve)), -1, "model");
  let hierarchyStarted = false;
  const hierarchy = provider.networkSlot(async () => { hierarchyStarted = true; }, 10, "hierarchy");
  await vi.waitFor(() => expect(hierarchyStarted).toBe(true));
  expect(releases).toHaveLength(16);
  releases[0]();
  await vi.waitFor(() => expect(releases).toHaveLength(17));
  releases.slice(1).forEach(release => release());
  await Promise.all([...active, blockedModel, hierarchy]);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("starts newly visible downloads despite a full old-view decode queue", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  const releases: (() => void)[] = [];
  const active = [0, 1].map(() => provider.modelDecodeSlot(() =>
    new Promise<void>(resolve => releases.push(resolve)), () => 1e9, provider.generation));
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  const buffered = Array.from({ length: 14 }, () => provider.modelDecodeSlot(async () => {},
    () => 1e9, provider.generation));
  expect(provider.modelDecodeWaiters).toHaveLength(14);
  const foregroundStarted = vi.fn();
  await provider.networkSlot(async () => { foregroundStarted(); }, 0, "model");
  expect(foregroundStarted).toHaveBeenCalledOnce();
  releases.forEach(release => release());
  await Promise.all([...active, ...buffered]);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("drops stale downloaded models before decoding after a movement restart", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  const releases: (() => void)[] = [];
  const active = [0, 1].map(() => provider.modelDecodeSlot(() =>
    new Promise<void>(resolve => releases.push(resolve)), () => 0, provider.generation));
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  const decode = vi.fn();
  const stale = provider.modelDecodeSlot(async () => { decode(); }, () => -1, provider.generation);
  provider.cancelPendingLoad();
  expect(await stale).toBeUndefined();
  expect(provider.stats.modelDecodeQueued).toBe(0);
  expect(decode).not.toHaveBeenCalled();
  releases.forEach(release => release());
  await Promise.all(active);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("keeps downloaded in-radius models queued across a Shift-movement preemption", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  const releases: (() => void)[] = [];
  const active = [0, 1].map(() => provider.modelDecodeSlot(() =>
    new Promise<void>(resolve => releases.push(resolve)), () => 0, provider.generation));
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  const decode = vi.fn(async () => "reused bytes");
  const downloaded = provider.modelDecodeSlot(decode, () => 0, provider.generation, () => true);
  provider.cancelPendingLoad(true);
  expect(provider.stats.modelDecodeQueued).toBe(1);
  releases[0]();
  expect(await downloaded).toBe("reused bytes");
  expect(decode).toHaveBeenCalledOnce();
  releases[1]();
  await Promise.all(active);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("integrates downloaded Google bytes after a movement restart without refetching", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const fetchMock = vi.fn(async () => ({ status: 200, ok: true,
    arrayBuffer: async () => createGLB({ asset: { version: "2.0" } }) }));
  vi.stubGlobal("fetch", fetchMock);
  const provider = new Google3DTiles(tileSet, { apiKey: "test", maxDepth: 0,
    tilesetLoader: async () => ({ root: { content: { uri: "tile.glb" } } }) }) as any;
  const originalDecodeSlot = provider.modelDecodeSlot.bind(provider);
  vi.spyOn(provider, "modelDecodeSlot").mockImplementation((_work, priority, generation, reuse) =>
    originalDecodeSlot(async () => {
      const asset = new AssetContainer(scene);
      asset.rootNodes.push(new TransformNode("downloaded model", scene));
      return { asset, attributions: [], rtcCenter: Vector3.Zero() };
    }, priority, generation, reuse));
  const releases: (() => void)[] = [];
  const active = [0, 1].map(() => originalDecodeSlot(() =>
    new Promise<void>(resolve => releases.push(resolve)), () => 0, provider.generation));
  try {
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const oldPass = provider.load();
    await vi.waitFor(() => expect(provider.stats.modelDecodeQueued).toBe(1));
    provider.cancelPendingLoad(true);
    const newPass = provider.load();
    releases.forEach(release => release());
    await Promise.all([oldPass, newPass, ...active]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(provider.stats.reusedDownloadedModels).toBe(1);
    expect(provider.loadedModelTiles).toHaveLength(1);
  } finally {
    releases.forEach(release => release());
    provider.dispose(); scene.dispose(); engine.dispose(); vi.unstubAllGlobals();
  }
});

it("reuses downloaded models only inside the current geographic window", () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  const origin = provider.getOrigin();
  provider.originStateKey = provider.getOriginStateKey(origin);
  expect(provider.canReusePendingModel({ boundingVolume: {
    region: [0.2, -0.3, 0.3, -0.2, 0, 100],
  } }, origin)).toBe(true);
  expect(provider.canReusePendingModel({ boundingVolume: {
    region: [-1.3, 0.7, -1.2, 0.8, 0, 100],
  } }, origin)).toBe(false);
  provider.cancelPendingLoad();
  expect(provider.canReusePendingModel({ boundingVolume: {
    region: [0.2, -0.3, 0.3, -0.2, 0, 100],
  } }, origin)).toBe(false);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("releases queued downloaded models when the provider is disposed", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  const releases: (() => void)[] = [];
  const active = [0, 1].map(() => provider.modelDecodeSlot(() =>
    new Promise<void>(resolve => releases.push(resolve)), () => 0, provider.generation));
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  const decode = vi.fn();
  const queued = provider.modelDecodeSlot(async () => { decode(); }, () => -1, provider.generation);
  provider.dispose();
  expect(await queued).toBeUndefined();
  expect(provider.stats.modelDecodeQueued).toBe(0);
  expect(decode).not.toHaveBeenCalled();
  releases.forEach(release => release());
  await Promise.all(active);
  scene.dispose(); engine.dispose();
});

it("reprioritizes downloaded models waiting for decode after a camera turn", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  const releases: (() => void)[] = [];
  const active = [0, 1].map(() => provider.modelDecodeSlot(() =>
    new Promise<void>(resolve => releases.push(resolve)), () => 0, provider.generation));
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  let eye = 0;
  const order: string[] = [];
  const formerNear = provider.modelDecodeSlot(async () => { order.push("former near"); },
    () => Math.abs(eye), provider.generation);
  const newlyNear = provider.modelDecodeSlot(async () => { order.push("newly near"); },
    () => Math.abs(100 - eye), provider.generation);
  eye = 100;
  vi.spyOn(provider, "cameraEye").mockReturnValue(new Vector3(eye, 0, 0));
  provider.reprioritizeRequests();
  releases[0]();
  await Promise.all([formerNear, newlyNear]);
  expect(order).toEqual(["newly near", "former near"]);
  releases[1]();
  await Promise.all(active);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("promotes queued tiles in the new view after a camera turn at the same position", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet, { cullToCamera: true }) as any;
  const releases: (() => void)[] = [];
  const active = Array.from({ length: 48 }, () => provider.networkSlot(() =>
    new Promise<void>(resolve => releases.push(resolve))));
  await Promise.resolve(); await Promise.resolve();
  expect(releases).toHaveLength(48);
  const east = { sphere: [1, 0, 0, 1] }, west = { sphere: [-1, 0, 0, 1] };
  vi.spyOn(provider, "tilePriority").mockReturnValue(10);
  let facing = east;
  vi.spyOn(provider, "allowedGeometricError").mockImplementation(volume => volume === facing ? 1 : -1);
  const order: string[] = [];
  const eastRequest = provider.networkSlot(async () => { order.push("east"); },
    () => provider.requestPriority(east, Matrix.Identity()));
  const westRequest = provider.networkSlot(async () => { order.push("west"); },
    () => provider.requestPriority(west, Matrix.Identity()));
  facing = west;
  provider.reprioritizeRequests();
  releases[0]();
  await vi.waitFor(() => expect(order[0]).toBe("west"));
  releases.slice(1,3).forEach(release => release());
  await Promise.all([eastRequest, westRequest]);
  expect(order).toEqual(["west", "east"]);
  releases.slice(3).forEach(release => release());
  await Promise.all(active);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("evaluates the shared network backlog once per camera priority revision", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  const activeReleases: (() => void)[] = [];
  const active = Array.from({ length: 48 }, () => provider.networkSlot(() =>
    new Promise<void>(resolve => activeReleases.push(resolve))));
  await vi.waitFor(() => expect(activeReleases).toHaveLength(48));
  const priority = vi.fn(() => 0);
  const waitingReleases: (() => void)[] = [];
  let unblock = false;
  const waiting = Array.from({ length: 128 }, () => provider.networkSlot(() =>
    unblock ? Promise.resolve() : new Promise<void>(resolve => waitingReleases.push(resolve)), priority));
  activeReleases[0]();
  await vi.waitFor(() => expect(waitingReleases).toHaveLength(1));
  expect(priority).toHaveBeenCalledTimes(128);
  activeReleases[1]();
  await vi.waitFor(() => expect(waitingReleases).toHaveLength(2));
  expect(priority).toHaveBeenCalledTimes(128);
  provider.reprioritizeRequests();
  activeReleases[2]();
  await vi.waitFor(() => expect(waitingReleases).toHaveLength(3));
  expect(priority).toHaveBeenCalledTimes(254);
  unblock = true;
  waitingReleases.forEach(release => release());
  activeReleases.slice(3).forEach(release => release());
  await Promise.all([...active, ...waiting]);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("starts outer-radius requests while visible requests remain queued", async () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet) as any;
  const activeReleases: (() => void)[] = [];
  const active = Array.from({ length: 48 }, () => provider.networkSlot(() =>
    new Promise<void>(resolve => activeReleases.push(resolve))));
  await vi.waitFor(() => expect(activeReleases).toHaveLength(48));
  const visibleReleases: (() => void)[] = [];
  const offscreenReleases: (() => void)[] = [];
  let unblockQueued = false;
  const visible = Array.from({ length: 16 }, () => provider.networkSlot(() =>
    unblockQueued ? Promise.resolve() : new Promise<void>(resolve => visibleReleases.push(resolve)), 0));
  const offscreen = Array.from({ length: 16 }, () => provider.networkSlot(() =>
    unblockQueued ? Promise.resolve() : new Promise<void>(resolve => offscreenReleases.push(resolve)), 1e9));
  activeReleases.slice(0, 8).forEach(release => release());
  await vi.waitFor(() => expect(visibleReleases.length + offscreenReleases.length).toBe(8));
  expect(visibleReleases.length).toBeGreaterThan(offscreenReleases.length);
  expect(offscreenReleases.length).toBeGreaterThan(0);
  unblockQueued = true;
  activeReleases.slice(8).forEach(release => release());
  visibleReleases.forEach(release => release());
  offscreenReleases.forEach(release => release());
  await Promise.all([...active, ...visible, ...offscreen]);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("ranks visible missing coverage and projected detail in the shared request queue", () => {
  const { engine, scene, tileSet } = createTileSet();
  const provider = new Google3DTiles(tileSet, { cullToCamera: true }) as any;
  vi.spyOn(provider, "tilePriority").mockReturnValue(100);
  vi.spyOn(provider, "allowedGeometricError").mockReturnValue(1);
  const volume = { sphere: [1, 0, 0, 1] };
  const missing = provider.requestPriority(volume, Matrix.Identity(), 2, false);
  const covered = provider.requestPriority(volume, Matrix.Identity(), 2, true);
  const urgent = provider.requestPriority(volume, Matrix.Identity(), 16, true);
  expect(missing).toBeLessThan(covered);
  expect(urgent).toBeLessThan(covered);
  vi.spyOn(provider, "tilePriority").mockImplementation((candidate: { sphere?: number[] }) =>
    candidate.sphere?.[0] === 2 ? 600 : 100);
  const sharperNearby = provider.requestPriority(volume, Matrix.Identity(), 2, true);
  const badlyCoarseFarther = provider.requestPriority({ sphere: [2, 0, 0, 1] }, Matrix.Identity(), 1024, true);
  expect(badlyCoarseFarther).toBeLessThan(sharperNearby);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("keeps loaded outer-radius coverage visible during a nearby foreground pass", async () => {
  const { engine, scene, tileSet } = createTileSet();
  tileSet.updateRaster(0, 0, 16);
  const radians = Math.PI / 180;
  const provider = new Google3DTiles(tileSet, { apiKey: "test", coverageRadius: 20000,
    maximumScreenSpaceError: 1,
    tilesetLoader: async () => ({ root: { children: [
      { boundingVolume: { region: [-0.001, -0.001, 0.001, 0.001] }, content: { uri: "near.glb" } },
      { boundingVolume: { region: [0.1 * radians, -0.001, 0.101 * radians, 0.001] }, content: { uri: "outer.glb" } },
    ] } }), modelTileLoader: createModelLoader([]),
  });
  expect(await provider.load()).toHaveLength(2);
  const outer = provider.loadedModelTiles.find(tile => tile.url.includes("outer.glb"))!;
  expect(await provider.load(1000)).toHaveLength(2);
  expect(outer.root.isEnabled()).toBe(true);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("commits independent replacement groups while a different subtree is still loading", async () => {
  const {engine, scene, tileSet} = createTileSet();
  let finish!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const slow = new Promise<void>(resolve => { finish = resolve; });
  const provider = new Google3DTiles(tileSet, {apiKey: "test", maximumScreenSpaceError: 1, maxDepth: 1, maxTiles: 256,
    tilesetLoader: async () => ({root: {children: Array.from({length: 64}, (_, i) => ({
      content: {uri: `parent-${i}.glb`}, children: [{content: {uri: `child-${i}-a.glb`}}, {content: {uri: `child-${i}-b.glb`}}],
    }))}}),
    modelTileLoader: async url => {
      if (url.includes("child-63-b.glb")) { started(); await slow; }
      return {asset: new AssetContainer(scene), attributions: []};
    },
  });
  const parents = await provider.load();
  expect(parents).toHaveLength(64);
  provider.maxDepth = 4;
  const loading = provider.load();
  await waiting;
  await vi.waitFor(() => expect(parents.find(tile => tile.url.includes("parent-0.glb"))!.root.isEnabled()).toBe(false));
  expect(parents.find(tile => tile.url.includes("parent-63.glb"))!.root.isEnabled()).toBe(true);
  finish(); await loading;
  expect(provider.loadedModelTiles).toHaveLength(128);
  expect(parents.every(tile => !tile.root.isEnabled())).toBe(true);
  expect(provider.stats.modelRequests).toBe(192);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("continues nearby refinement while requesting regional coverage", async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(0, 0), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld)); camera.getViewMatrix(true);
  const sphere = (lon: number) => { const a = lon * Math.PI / 180; return { sphere: [6378137 * Math.cos(a), 6378137 * Math.sin(a), 0, 10] }; };
  const hierarchy: string[] = [];
  const provider = new Google3DTiles(globe, { apiKey: "test", maximumScreenSpaceError: 1, maxTiles: 64, coverageRadius: 10000,
    maximumDisplayGeometricError: 33, coverageRegion: { south: -0.1, north: 0.1, west: -0.1, east: 0.1 },
    tilesetLoader: async url => {
      if (url.includes("branch-")) { hierarchy.push(url); return { root: { geometricError: 0, content: { uri: url.replace(".json", ".glb") } } }; }
      return { root: { children: Array.from({ length: 17 }, (_, i) => ({ boundingVolume: sphere(i === 0 ? 0 : 0.01 + i * 0.001),
        geometricError: i === 0 ? 16 : 128, content: { uri: `coarse-${i}.glb` }, children: [{ content: { uri: `branch-${i}.json` } }] })) } };
    }, modelTileLoader: createModelLoader([]) });
  try {
    await provider.load();
    expect(hierarchy.findIndex(url => url.includes("branch-0.json"))).toBeGreaterThanOrEqual(0);
    expect(hierarchy).toHaveLength(17);
  }
  finally { provider.dispose(); scene.dispose(); engine.dispose(); }
});
