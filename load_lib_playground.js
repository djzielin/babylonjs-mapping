//var filePrefix="https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/lib/"; //causes MIME type error
var filePrefix = "https://cdn.jsdelivr.net/gh/djzielin/babylonjs-mapping";
var commitVer = "";

var allFiles = [
    "/lib_playground/Attribution.js",
    "/lib_playground/Buildings.js",
    "/lib_playground/BuildingsCustom.js",
    "/lib_playground/BuildingsOSM.js",
    "/lib_playground/GeoJSON.js",
    "/lib_playground/MapBox.js",
    "/lib_playground/OpenStreetMap.js",
    "/lib_playground/Tile.js",
    "/lib_playground/TileMath.js",
    "/lib_playground/TileSet.js"
];

var numScriptsLoaded = 0;
var loadOneAtATime=true;

//per documentation at: https://doc.babylonjs.com/toolsAndResources/thePlayground/externalPGAssets
//per example at: https://playground.babylonjs.com/#WF3VKZ


//per https://stackoverflow.com/questions/9659265/check-if-javascript-script-exists-on-page
function isMyScriptLoaded(url) {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].src == url) return true;
    }
    return false;
}

function loadSingleScript(url, attachPoint, callbackFunction) {
    console.log("trying to load: " + url);

    var isLoaded = isMyScriptLoaded(url);

    if (isLoaded) {
        console.log("script already present on page");
        numScriptsLoaded++;

        CheckIfAllLoaded(url, attachPoint, callbackFunction);

        return;
    }

    var s = document.createElement("script");
    s.type = "text/javascript";
    s.src = url;
    attachPoint.head.appendChild(s);

    s.onload = function () {
        console.log(url + " has been loaded!");
        numScriptsLoaded++;

        CheckIfAllLoaded(attachPoint, callbackFunction);
    }
}

function CheckIfAllLoaded(attachPoint, callbackFunction){
    if (numScriptsLoaded == allFiles.length) {
        console.log("all babylonjs-mapping scripts are loaded!");
        callbackFunction();
    } else {
        console.log("not done yet. only have: " + numScriptsLoaded + " loaded out of: " + allFiles.length);
        if(loadOneAtATime){
            loadSingleScript(filePrefix + allFiles[numScriptsLoaded], attachPoint, callbackFunction);
        }
    }
}

function loadAllMappingScripts(commitVer, attachPoint, callbackFunction) {
    console.log("trying to load all babylonjs-mapping scripts");
    filePrefix=filePrefix+commitVer;

    if(loadOneAtATime){
        loadSingleScript(filePrefix + allFiles[numScriptsLoaded], attachPoint, callbackFunction);
    }
    else{
        for (const script of allFiles) {
            loadSingleScript(filePrefix + script, attachPoint, callbackFunction);
        }
    }
}

