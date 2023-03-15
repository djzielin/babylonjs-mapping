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
  regex: "new Vector2",
  replacement: "new BABYLON.Vector2",
  paths: ['./lib_playground/'],
  recursive: true,
  silent: false,
});