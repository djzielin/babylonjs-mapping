import { describe, it, expect, vi } from 'vitest';
import { NullEngine, Scene, Vector2, Vector3, VertexBuffer } from '@babylonjs/core';
import GlobeSet from '../src/core/GlobeSet';
import GlobeDataController from '../src/core/GlobeDataController';
import TerrainRGB, { type ElevationGrid } from '../src/terrain/TerrainRGB';
import BuildingsOSM from '../src/buildings/BuildingsOSM';
import { GeoJSON, type feature } from '../src/buildings/GeoJSON';
import { EPSG_Type } from '../src/core/TileMath';

vi.mock('../src/core/Attribution',()=>({default:class { advancedTexture={}; addAttribution(){} }}));
function setup(size=1, latitude=35, longitude=-79, zoom=15) {
    const engine=new NullEngine({renderWidth:512,renderHeight:512,textureSize:512,deterministicLockstep:false,lockstepMaxSteps:4,useHighPrecisionMatrix:true}), scene=new Scene(engine);
    const globe=new GlobeSet(scene,engine,{radius:60,backingSurface:false});
    globe.createGeometry(new Vector2(size,size),20,8);
    globe.updateRaster(latitude,longitude,zoom);
    return {globe,scene,dispose:()=>{scene.dispose();engine.dispose();}};
}
function worldVertices(mesh:any):Vector3[] {
    const data=mesh.getVerticesData(VertexBuffer.PositionKind), matrix=mesh.computeWorldMatrix(true), points=[];
    for(let i=0;i<data.length;i+=3)points.push(Vector3.TransformCoordinates(new Vector3(data[i],data[i+1],data[i+2]),matrix));
    return points;
}
const grid=(height:number):ElevationGrid=>({data:[height,height,height,height],width:2,height:2});

describe('globe data fidelity',()=>{
    it.each([0,35,-60,84])('places signed elevations radially at latitude %i',latitude=>{
        const {globe,dispose}=setup(1,latitude);
        const tile=globe.ourTiles[0];
        globe.setElevationData(tile,[-500,-500,-500,-500],2,2,2);
        for(const point of worldVertices(tile.mesh))expect(point.length()).toBeCloseTo(60-1000*globe.metresToWorld,7);
        expect(tile.terrainLoaded).toBe(true);
        const center=globe.getSurfaceCoordinates(globe.getTileSurfacePosition(tile.tileCoords));
        expect(globe.sampleElevation(center.latitude,center.longitude)).toBeCloseTo(-1000*globe.metresToWorld,10);
        dispose();
    });
    it('preserves building height, pitched roofs and geographic placement above terrain',()=>{
        const {globe,scene,dispose}=setup();
        const tile=globe.ourTiles[0];
        globe.setElevationData(tile,[1000,1000,1000,1000],2,2);
        const center=globe.getSurfaceCoordinates(globe.getTileSurfacePosition(tile.tileCoords));
        const x=center.longitude,y=center.latitude,d=0.0001;
        const f:feature={id:'building',type:'Feature',properties:{height:100,roofShape:'gabled',roofHeight:20},geometry:{type:'Polygon',coordinates:[[[x-d,y-d],[x+d,y-d],[x+d,y+d],[x-d,y+d],[x-d,y-d]]]}};
        const settings=new BuildingsOSM(globe);
        new GeoJSON(globe,scene).generateSingleBuilding('test',f,EPSG_Type.EPSG_4326,tile,false,settings);
        expect(tile.buildings).toHaveLength(1);
        const heights=worldVertices(tile.buildings[0].mesh).map(p=>(p.length()-globe.radius)/globe.metresToWorld);
        expect(Math.min(...heights)).toBeCloseTo(1000,2);
        expect(Math.max(...heights)).toBeCloseTo(1100,2);
        const vertices=tile.buildings[0].mesh.getVerticesData(VertexBuffer.PositionKind)!;
        expect(Math.max(...Array.from(vertices).map(Math.abs))).toBeLessThan(0.01);
        dispose();
    });
    it('keeps public coordinate round trips spherical and generation coordinates planar',()=>{
        const {globe,dispose}=setup();const ll=new Vector2(-79,35);
        const point=globe.ourTileMath.EPSG_to_Game(ll,EPSG_Type.EPSG_4326);
        expect(point.length()).toBeCloseTo(60,9);
        expect(globe.ourTileMath.Game_to_LonLat(point).x).toBeCloseTo(ll.x,9);
        expect(globe.getGeometryMath().EPSG_to_Game(ll,EPSG_Type.EPSG_4326).length()).toBeCloseTo(0,9);
        dispose();
    });
    it('retains overlapping geometry, DEM and in-flight imagery when the view moves',()=>{
        const {globe,dispose}=setup(3);
        const old=[...globe.ourTiles];
        const retained=old[4];globe.setElevationData(retained,[50,50,50,50],2,2);
        const update=vi.spyOn(retained.mesh,'setVerticesData');
        const coords=retained.tileCoords.clone();
        const lon=globe.ourTileMath.tile_to_lon(coords.x+1.5,coords.z);
        globe.updateRaster(35,lon,15);
        expect(globe.ourTilesMap.get(coords.toString())).toBe(retained);
        expect(retained.terrainLoaded).toBe(true);
        expect(update).not.toHaveBeenCalled();
        expect((globe as any).tileRequests).toHaveLength(9);
        dispose();
    });
    it('does no reprojection for an unchanged view',()=>{
        const {globe,dispose}=setup(3);
        const project=vi.spyOn(globe,'getTileSurfacePosition');
        for(let i=0;i<20;i++)globe.updateRaster(35,-79,15);
        expect(project).not.toHaveBeenCalled();dispose();
    });
    it('stitches elevation rather than global Y and keeps globe LOD radial',()=>{
        const {globe,dispose}=setup(2);
        for(const tile of globe.ourTiles)globe.setElevationData(tile,[200,200,200,200],2,2);
        globe.ourTerrainMB.fixTileSeams();
        globe.setupTerrainLOD([4,2],[1,2],0.001);
        for(const tile of globe.ourTiles) {
            const points=worldVertices(tile.terrainLODMeshes[0]);
            for(const p of points.slice(0,25))expect(p.length()).toBeCloseTo(60+200*globe.metresToWorld,6);
        }
        dispose();
    });
    it('rejects bad numeric grids without modifying terrain',()=>{
        const {globe,dispose}=setup();const tile=globe.ourTiles[0];
        expect(()=>globe.setElevationData(tile,[0,NaN,0,0],2,2)).toThrow();
        expect(()=>globe.setElevationData(tile,[0,0,0],2,2)).toThrow();
        expect(tile.terrainLoaded).toBe(false);dispose();
    });
    it('keeps polar requests inside the Mercator grid',()=>{
        const {globe,dispose}=setup(5,89,179,3);
        expect(globe.ourTiles.every(t=>t.tileCoords.y>=0&&t.tileCoords.y<8)).toBe(true);
        dispose();
    });
});

describe('bounded detail streaming',()=>{
    it('limits concurrency and drops late results after relocation',async()=>{
        const {globe,dispose}=setup(2);
        const pending:Array<{resolve:(grid:ElevationGrid)=>void,signal:AbortSignal}>=[];
        const loader=vi.fn((_c:Vector3,signal:AbortSignal)=>new Promise<ElevationGrid>(resolve=>pending.push({resolve,signal})));
        const data=new GlobeDataController(globe,{elevation:loader,concurrency:2});
        data.update();data.update();expect(loader).toHaveBeenCalledTimes(2);
        globe.updateRaster(-33,151,15);data.update();
        expect(pending.every(p=>p.signal.aborted)).toBe(true);
        pending.forEach(p=>p.resolve(grid(999)));await Promise.resolve();await Promise.resolve();
        expect(globe.ourTiles.every(t=>!t.terrainLoaded)).toBe(true);
        data.update();expect(loader).toHaveBeenCalledTimes(4);
        pending.slice(2).forEach(p=>p.resolve(grid(-100)));await Promise.resolve();await Promise.resolve();
        expect(globe.ourTiles.filter(t=>t.terrainLoaded)).toHaveLength(2);
        expect(data.stats.active).toBe(0);data.dispose();dispose();
    });
    it('reports errors once and explicitly retries on invalidation',async()=>{
        const {globe,dispose}=setup();
        const loader=vi.fn(async()=>{throw new Error('offline');});
        const data=new GlobeDataController(globe,{elevation:loader});const error=vi.fn();data.onErrorObservable.add(error);
        data.update();await Promise.resolve();await Promise.resolve();data.update();
        expect(loader).toHaveBeenCalledOnce();expect(error).toHaveBeenCalledOnce();
        data.invalidate();data.update();await Promise.resolve();await Promise.resolve();
        expect(loader).toHaveBeenCalledTimes(2);data.dispose();dispose();
    });
});

describe('terrain encodings and overzoom',()=>{
    it('decodes genuine signed Terrarium and Mapbox values',()=>{
        expect(Array.from(TerrainRGB.decode([128,0,0,255,127,255,0,255,128,1,128,255],'terrarium'))).toEqual([0,-1,1.5]);
        expect(TerrainRGB.decode([0,0,0,255],'mapbox')[0]).toBe(-10000);
    });
    it('samples the correct ancestor quadrant when overzooming',()=>{
        const data=Array.from({length:16},(_,i)=>i);
        const left=TerrainRGB.crop({data,width:4,height:4},new Vector3(0,0,1),0);
        const right=TerrainRGB.crop({data,width:4,height:4},new Vector3(1,0,1),0);
        expect(left.data[0]).toBe(0);expect(right.data[0]).toBe(2);
        expect(left.data[left.width-1]).toBe(right.data[0]);
    });
});
