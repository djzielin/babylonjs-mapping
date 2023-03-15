var replace = require("replace");

//remove import statements
replace({
  regex: "import.*",
  replacement: "",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

//remove export statements
replace({
  regex: "export default",
  replacement: "",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

//remove export statements
replace({
  regex: "export var",
  replacement: "var",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

//remove export statements
replace({
  regex: "export class",
  replacement: "class",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

//////////////////////////////////////////////
// Add BABYLON prefix to needed classes
//////////////////////////////////////////////
replace({
  regex: "new Vector3",
  replacement: "new BABYLON.Vector3",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "new Color3",
  replacement: "new BABYLON.Color3",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "new Vector2",
  replacement: "new BABYLON.Vector2",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "new Observable",
  replacement: "new BABYLON.Observable",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "new StandardMaterial",
  replacement: "new BABYLON.StandardMaterial",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "new Texture",
  replacement: "new BABYLON.Texture",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "[ \t]EngineStore[.]",
  replacement: "BABYLON.EngineStore.",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "[ \t]Texture[.]",
  replacement: "BABYLON.Texture.",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "[ \t]MeshBuilder[.]",
  replacement: "BABYLON.MeshBuilder.",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

///////////////////////////////////
// GUI
///////////////////////////////////

replace({
  regex: "new StackPanel",
  replacement: "new BABYLON.GUI.StackPanel",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "AdvancedDynamicTexture[.]",
  replacement: "BABYLON.GUI.AdvancedDynamicTexture.",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "Button[.]",
  replacement: "BABYLON.GUI.Button.",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

replace({
  regex: "Control[.]",
  replacement: "BABYLON.GUI.Control.",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});

