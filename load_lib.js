//var filePrefix="https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/lib/"; //causes MIME type error
var filePrefix="https://cdn.jsdelivr.net/gh/djzielin/babylonjs-mapping";


var allFiles=[
    //"/lib/Attribution.js",
    //"/lib/Buildings.js",
    //"/lib/BuildingsOSM.js",
    //"/lib/GeoJSON.js",
    //"/lib/MapBox.js",
    "/lib/OpenStreetMap.js",
    //"/lib/OpenStreetMapBuildings.js",
    "/lib/Tile.js",
    "/lib/TileMath.js",
    "/lib/TileSet.js"
];

var numScriptsLoaded=0;

//per documentation at: https://doc.babylonjs.com/toolsAndResources/thePlayground/externalPGAssets
//per example at: https://playground.babylonjs.com/#WF3VKZ
function loadSingleScript(url, callbackFunction){
    console.log("trying to load: " + url);
    var s = document.createElement("script");
    //s.type = "text/javascript";
    s.type="module"; //per https://stackoverflow.com/questions/42237388/syntaxerror-import-declarations-may-only-appear-at-top-level-of-a-module
    s.src = url;
    document.head.appendChild(s);

    s.onload = function() {
        console.log(url + " has been loaded!");
	    numScriptsLoaded++;
        checkIfAllLoaded(callbackFunction);
    }
}

function checkIfAllLoaded(callbackFunction){
    if(numScriptsLoaded==allFiles.length){
        console.log("all babylonjs-mapping scripts are loaded!"); 
        callbackFunction();
    } else{
        console.log("only have: " + numScriptsLoaded + " loaded out of: " + allFiles.length);
    }
}

function loadAllMappingScripts(commitVer,callbackFunction){
    console.log("trying to load all babylonjs-mapping scripts");
    for(const script of allFiles){
        loadSingleScript(filePrefix+commitVer+script,callbackFunction);
    }
}

