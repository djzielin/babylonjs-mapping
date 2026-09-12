import { expect, it, vi } from "vitest";
import { NullEngine, Scene, Vector2, Vector3, Mesh, Ray, VertexData } from "@babylonjs/core";
import GlobeSet from "../src/core/GlobeSet";
import { GlobeBuildingBatch } from "../src/buildings/GlobeBuildingBatch";
import type { feature } from "../src/buildings/GeoJSON";
vi.mock("../src/core/Attribution",()=>({default:class {advancedTexture={};addAttribution(){}}}));

it("batches radial walls and roofs while retaining courtyard holes and outward normals",()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    const globe=new GlobeSet(scene,engine,{radius:60,attribution:false});
    globe.createGeometry(new Vector2(1,1),20,2);globe.updateRaster(0,0,14);
    vi.spyOn(globe,"sampleElevation").mockReturnValue(10*globe.metresToWorld);
    const batch=new GlobeBuildingBatch(globe,globe.getSurfacePosition(0,0));
    batch.append({type:"Feature",properties:{height:30},geometry:{type:"Polygon",coordinates:[
        [[0,0],[0.001,0],[0.001,0.001],[0,0.001],[0,0]],
        [[0.0003,0.0003],[0.0007,0.0003],[0.0007,0.0007],[0.0003,0.0007],[0.0003,0.0003]],
    ]}} as feature,4,1);
    const mesh=new Mesh("batch",scene);batch.vertexData().applyToMesh(mesh);mesh.position.copyFrom(batch.origin);mesh.computeWorldMatrix(true);
    const hit=(lat:number,lon:number)=>new Ray(globe.getSurfacePosition(lat,lon,100*globe.metresToWorld),globe.getSurfaceNormal(lat,lon).negate(),200*globe.metresToWorld).intersectsMesh(mesh).hit;
    expect(hit(0.0001,0.0001)).toBe(true);
    expect(hit(0.0005,0.0005)).toBe(false);
    const calculated:number[]=[];VertexData.ComputeNormals(batch.positions,batch.indices,calculated);
    for(let i=0;i<calculated.length;i+=3) expect(Vector3.Dot(Vector3.FromArray(calculated,i),Vector3.FromArray(batch.normals,i))).toBeGreaterThan(0.999);
    const radii=[];
    for(let i=0;i<batch.positions.length;i+=3) radii.push(Vector3.FromArray(batch.positions,i).add(batch.origin).length());
    expect(Math.min(...radii)).toBeCloseTo(60+10*globe.metresToWorld,9);
    expect(Math.max(...radii)).toBeCloseTo(60+40*globe.metresToWorld,9);
    expect(batch.featureCount).toBe(1);
    scene.dispose();engine.dispose();
});

it("builds thousands of footprints without allocating a mesh per building",()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    const globe=new GlobeSet(scene,engine,{radius:60,attribution:false});
    globe.createGeometry(new Vector2(1,1),20,2);globe.updateRaster(0,0,14);
    const before=scene.meshes.length;
    const batch=new GlobeBuildingBatch(globe,globe.getSurfacePosition(0,0));
    const started=performance.now();
    for(let i=0;i<2000;i++) {
        const x=(i%50)*0.0002,y=Math.floor(i/50)*0.0002;
        batch.append({type:"Feature",properties:{height:12},geometry:{type:"Polygon",coordinates:[[[x,y],[x+0.0001,y],[x+0.0001,y+0.0001],[x,y+0.0001],[x,y]]]}} as feature,4,1);
    }
    expect(scene.meshes.length).toBe(before);
    expect(batch.featureCount).toBe(2000);
    expect(batch.positions.length/3).toBe(40000);
    expect(batch.indices.length).toBe(60000);
    console.log("2000 direct building geometries",Math.round(performance.now()-started),"ms");
    scene.dispose();engine.dispose();
});

it("atomically replaces a building batch and keeps the old one if work is cancelled",async()=>{
    const {default:BuildingsOverture}=await import("../src/buildings/BuildingsOverture");
    const engine=new NullEngine(),scene=new Scene(engine);
    const globe=new GlobeSet(scene,engine,{radius:60,attribution:false});
    globe.createGeometry(new Vector2(1,1),20,2);globe.updateRaster(0,0,14);
    const tile=globe.ourTiles[0];
    const provider=new BuildingsOverture(globe,"https://example.invalid/buildings.pmtiles");
    const feature={type:"Feature",properties:{height:12},geometry:{type:"Polygon",coordinates:[[[0,0],[0.001,0],[0.001,0.001],[0,0.001],[0,0]]]}} as feature;
    const old=new Mesh("old batch",scene);tile.buildingBatches.push(old);
    const request:any={tile,tileCoords:tile.tileCoords.clone(),inProgress:true};
    let time=0;const clock=vi.spyOn(performance,"now").mockImplementation(()=>time+=10);
    const cancelled=(provider as any).buildBatch(request,[feature]);
    expect(old.isDisposed()).toBe(false);
    request.cancelled=true;await cancelled;clock.mockRestore();
    expect(old.isDisposed()).toBe(false);
    await (provider as any).buildBatch({...request,cancelled:false},[feature]);
    expect(old.isDisposed()).toBe(true);
    expect(tile.buildingBatches).toHaveLength(1);
    expect(tile.buildingBatches[0].metadata.buildingCount).toBe(1);
    const mesh=tile.buildingBatches[0];
    const vertices=mesh.getVertexBuffer("position");
    const indices=Array.from(mesh.getIndices()!);
    provider.batchVisibilityFilter=()=>false;
    provider.updateBatchVisibility();
    expect(mesh.isEnabled(false)).toBe(false);
    provider.batchVisibilityFilter=()=>true;
    provider.updateBatchVisibility();
    expect(mesh.isEnabled(false)).toBe(true);
    expect(mesh.getVertexBuffer("position")).toBe(vertices);
    expect(Array.from(mesh.getIndices()!)).toEqual(indices);
    expect(tile.buildingBatches[0]).toBe(mesh);
    tile.deleteBuildings();expect(tile.buildingBatches).toHaveLength(0);
    scene.dispose();engine.dispose();
});
