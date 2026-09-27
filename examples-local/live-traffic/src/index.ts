import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Material } from '@babylonjs/core/Materials/material';
import { Color3, Color4, Vector2, Vector3 } from '@babylonjs/core/Maths/math';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TileSet, RasterOSM, EPSG_Type } from '../../../lib/index.js';
import type { AircraftPosition, RoadSpeed, VesselPosition } from '../../../lib/index.js';
import { drawTrafficIcon, trailingPoint } from '../../../examples-shared/TrafficIcon';

type Snapshot = { roads: RoadSpeed[]; aircraft: AircraftPosition[]; ships: VesselPosition[]; errors?: Record<string,string>; sources?: Record<string,string>; updatedAt?: number };
const sample: Snapshot = {
  roads: [
    {id:'1',name:'West Side Highway',speedMph:22,observedAt:'sample',path:[[40.700,-74.016],[40.731,-74.010],[40.760,-74.003],[40.788,-73.991]].map(([latitude,longitude])=>({latitude,longitude}))},
    {id:'2',name:'FDR Drive',speedMph:43,observedAt:'sample',path:[[40.702,-73.972],[40.724,-73.971],[40.747,-73.967],[40.774,-73.939]].map(([latitude,longitude])=>({latitude,longitude}))},
    {id:'3',name:'Brooklyn Queens Expressway',speedMph:12,observedAt:'sample',path:[[40.667,-74.000],[40.681,-73.989],[40.701,-73.989],[40.719,-73.954],[40.745,-73.945]].map(([latitude,longitude])=>({latitude,longitude}))},
    {id:'4',name:'Long Island Expressway',speedMph:31,observedAt:'sample',path:[[40.741,-73.957],[40.739,-73.920],[40.735,-73.880],[40.732,-73.840]].map(([latitude,longitude])=>({latitude,longitude}))},
    {id:'5',name:'Staten Island Expressway',speedMph:null,observedAt:'sample',path:[[40.610,-74.197],[40.612,-74.155],[40.611,-74.111],[40.615,-74.065]].map(([latitude,longitude])=>({latitude,longitude}))},
  ],
  aircraft: [
    {id:'a1',callsign:'NYC101',latitude:40.711,longitude:-73.820,altitudeMeters:2400,heading:245,speedMetersPerSecond:140,observedAt:0},
    {id:'a2',callsign:'NYC202',latitude:40.669,longitude:-73.760,altitudeMeters:1100,heading:65,speedMetersPerSecond:95,observedAt:0},
    {id:'a3',callsign:'NYC303',latitude:40.811,longitude:-73.890,altitudeMeters:3200,heading:180,speedMetersPerSecond:155,observedAt:0},
  ],
  ships: [
    {id:'s1',name:'HARBOR ONE',latitude:40.663,longitude:-74.066,heading:39,speedKnots:9.2,observedAt:0},
    {id:'s2',name:'EAST RIVER',latitude:40.712,longitude:-73.974,heading:22,speedKnots:6.5,observedAt:0},
    {id:'s3',name:'SANDY HOOK',latitude:40.585,longitude:-74.015,heading:312,speedKnots:12.1,observedAt:0},
  ],
};

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.035,0.085,0.12,1);
const camera = new ArcRotateCamera('camera', -Math.PI/2, 0.38, 145, Vector3.Zero(), scene);
camera.lowerRadiusLimit = 55; camera.upperRadiusLimit = 420;
camera.attachControl(canvas, true);
const light = new HemisphericLight('light', new Vector3(0,1,0), scene);
light.intensity = 1.2;
const map = new TileSet(scene, engine);
map.setRasterProvider(new RasterOSM(map));
map.createGeometry(new Vector2(8,8), 24, 2);
map.updateRaster(40.73, -73.97, 11);
const overlay: AbstractMesh[] = [];

function point(latitude: number, longitude: number, height = 0.5): Vector3 {
  const position = map.ourTileMath.EPSG_to_Game(new Vector2(longitude,latitude), EPSG_Type.EPSG_4326);
  position.y = height;
  return position;
}
function material(name: string, color: Color3): StandardMaterial {
  const result = new StandardMaterial(name,scene);
  result.diffuseColor = color;
  result.emissiveColor = color;
  result.disableLighting = true;
  return result;
}
const roadColors = [new Color3(.91,.47,.40),new Color3(.91,.73,.40),new Color3(.45,.84,.64),new Color3(.47,.53,.58)];
const roadMaterials = roadColors.map((color,index)=>material(`Road speed ${index}`,color));
const planeTrail = material('Aircraft trails',new Color3(.39,.79,1)); planeTrail.alpha=.55;
const shipWake = material('Vessel wakes',new Color3(.7,.54,1)); shipWake.alpha=.55;
function iconMaterial(kind: 'aircraft'|'ship'): StandardMaterial {
  const texture = new DynamicTexture(`${kind} icon`,{width:128,height:128},scene,false);
  drawTrafficIcon(texture.getContext() as unknown as CanvasRenderingContext2D,kind);
  texture.hasAlpha = true;
  texture.update();
  const result = material(`${kind} badge`,Color3.White());
  result.diffuseTexture = texture;
  result.useAlphaFromDiffuseTexture = true;
  result.transparencyMode = Material.MATERIAL_ALPHABLEND;
  result.backFaceCulling = false;
  return result;
}
const planeMaterial = iconMaterial('aircraft');
const shipMaterial = iconMaterial('ship');
function draw(snapshot: Snapshot): void {
  for (const mesh of overlay) mesh.dispose();
  overlay.length = 0;
  const roadBands: Mesh[][] = [[],[],[],[]];
  for (const road of snapshot.roads) {
    const points = road.path.map(p=>point(p.latitude,p.longitude,.8));
    if (points.length < 2) continue;
    const band = road.speedMph === null ? 3 : road.speedMph < 20 ? 0 : road.speedMph < 40 ? 1 : 2;
    const core = MeshBuilder.CreateTube(`Road: ${road.name}`,{path:points,radius:.29,tessellation:4},scene);
    core.material = roadMaterials[band];
    roadBands[band].push(core);
  }
  for (let band=0;band<4;band++) if (roadBands[band].length) {
    const mesh=Mesh.MergeMeshes(roadBands[band],true,true);
    if (mesh) { mesh.material=roadMaterials[band]; overlay.push(mesh); }
  }
  for (const aircraft of snapshot.aircraft) {
    const height=4+Math.min(3,Math.max(0,(aircraft.altitudeMeters ?? 500)/1500));
    if (aircraft.heading !== null) {
      const behind=trailingPoint(aircraft.latitude,aircraft.longitude,aircraft.heading,.025);
      const trail=MeshBuilder.CreateTube(`Aircraft trail: ${aircraft.callsign}`,{path:[point(behind.latitude,behind.longitude,height),point(aircraft.latitude,aircraft.longitude,height)],radius:.11,tessellation:4},scene);
      trail.material=planeTrail; overlay.push(trail);
    }
    const mesh = MeshBuilder.CreatePlane(`Aircraft: ${aircraft.callsign}`,{size:5.2},scene);
    mesh.position = point(aircraft.latitude,aircraft.longitude,height);
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.material = planeMaterial;
    overlay.push(mesh);
  }
  for (const ship of snapshot.ships) {
    if (ship.heading !== null) for (const offset of [-18,18]) {
      const behind=trailingPoint(ship.latitude,ship.longitude,ship.heading+offset,.016);
      const wake=MeshBuilder.CreateTube(`Ship wake: ${ship.name}`,{path:[point(behind.latitude,behind.longitude,1.2),point(ship.latitude,ship.longitude,1.2)],radius:.1,tessellation:4},scene);
      wake.material=shipWake; overlay.push(wake);
    }
    const mesh = MeshBuilder.CreatePlane(`Ship: ${ship.name}`,{size:4.8},scene);
    mesh.position = point(ship.latitude,ship.longitude,2.2);
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.material = shipMaterial;
    overlay.push(mesh);
  }
  for (const [id,count] of [['road-count',snapshot.roads.length],['air-count',snapshot.aircraft.length],['ship-count',snapshot.ships.length]] as const)
    document.getElementById(id)!.textContent = String(count);
}
draw(sample);
engine.runRenderLoop(()=>scene.render());
window.addEventListener('resize',()=>engine.resize());

let mode: 'sample'|'live' = 'sample';
async function updateLive(): Promise<void> {
  if (mode !== 'live') return;
  const status = document.getElementById('status')!;
  status.textContent = 'Loading live data…';
  try {
    const response = await fetch('/api/traffic');
    if (!response.ok) throw new Error(`Demo server returned ${response.status}`);
    const data = await response.json() as Snapshot;
    if (mode !== 'live') return;
    draw(data);
    const failures = Object.values(data.errors ?? {});
    status.textContent = failures.length ? failures.join(' · ') : data.sources?.ships === 'AISStream key required' ? 'Live · AIS key needed for ships' : 'Live data';
  } catch (error) { status.textContent = `Live feed unavailable: ${String(error)}`; }
}
document.getElementById('sample')!.addEventListener('click',()=>{
  mode='sample'; draw(sample);
  document.getElementById('sample')!.classList.add('active'); document.getElementById('live')!.classList.remove('active');
  document.getElementById('sample')!.setAttribute('aria-pressed','true'); document.getElementById('live')!.setAttribute('aria-pressed','false');
  document.getElementById('status')!.textContent='Sample data';
});
document.getElementById('live')!.addEventListener('click',()=>{
  mode='live'; document.getElementById('live')!.classList.add('active'); document.getElementById('sample')!.classList.remove('active');
  document.getElementById('live')!.setAttribute('aria-pressed','true'); document.getElementById('sample')!.setAttribute('aria-pressed','false');
  void updateLive();
});
setInterval(()=>void updateLive(),60_000);
