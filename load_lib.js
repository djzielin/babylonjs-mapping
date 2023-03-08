//var filePrefix="https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/lib/"; //causes MIME type error
var filePrefix="https://cdn.jsdelivr.net/gh/djzielin/babylonjs-mapping/lib/";

var allFiles=[
    "Attribution.js",
    "Buildings.js",
    "Buildings.js",
    "BuildingsOSM.js",
    "GeoJSON.js",
    "MapBox.js",
    "OpenStreetMap.js",
    "OpenStreetMapBuildings.js",
    "Tile.js",
    "TileMath.js",
    "TileSet.js",
];

var numScriptsLoaded=0;

//per documentation at: https://doc.babylonjs.com/toolsAndResources/thePlayground/externalPGAssets
//per example at: https://playground.babylonjs.com/#WF3VKZ
function loadSingleScript(url, callbackFunction){
    console.log("trying to load: " + url);
    var s = document.createElement("script");
    s.type = "text/javascript";
    s.src = url;
    document.head.appendChild(s);

    s.onload = function() {
        console.log(url + " has been loaded!");
	    numScriptsLoaded++;
        checkIfAllLoaded(callbackFunction);
    }
}

function checkIfAllLoaded(){
    if(numScriptsLoaded==allFiles.length){
        console.log("all babylonjs-mapping scripts are loaded!"); 
        callbackFunction();
    }
}

function loadAllMappingScripts(callbackFunction){
    console.log("trying to load all babylonjs-mapping scripts");
    for(const script of allFiles){
        loadSingleScript(filePrefix+script,callbackFunction);
    }
}

