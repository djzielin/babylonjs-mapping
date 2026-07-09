import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

function run(command, args, cwd) {
    return execFileSync(command, args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
}

async function main() {
    run("npm", ["run", "build"], repoRoot);

    const consumerDir = await mkdtemp(path.join(tmpdir(), "babylonjs-mapping-consumer-"));
    const srcDir = path.join(consumerDir, "src");
    try {
        await mkdir(srcDir, { recursive: true });

        await writeFile(
            path.join(consumerDir, "package.json"),
            JSON.stringify(
                {
                    name: "babylonjs-mapping-consumer",
                    private: true,
                },
                null,
                2,
            ),
        );

        await writeFile(
            path.join(consumerDir, "webpack.config.cjs"),
            `const path = require("node:path");\n\nmodule.exports = {\n  mode: "production",\n  entry: "./src/index.js",\n  resolve: {\n    extensions: [".js"],\n  },\n  module: {\n    rules: [\n      {\n        test: /\\.m?js$/,\n        resolve: {\n          fullySpecified: false,\n        },\n      },\n    ],\n  },\n  output: {\n    path: path.resolve(__dirname, "dist"),\n    filename: "bundle.js",\n  },\n};\n`,
        );

        await writeFile(
            path.join(srcDir, "index.js"),
            [
                'import TileSet, { RetrievalLocation } from "babylonjs-mapping";',
                'import TileMath, { EPSG_Type } from "babylonjs-mapping/lib/TileMath";',
                'import BuildingsOSM from "babylonjs-mapping/lib/BuildingsOSM";',
                "",
                "if (typeof TileSet !== \"function\") throw new Error(\"TileSet root export is not a function\");",
                "if (typeof TileMath !== \"function\") throw new Error(\"TileMath subpath export is not a function\");",
                "if (typeof BuildingsOSM !== \"function\") throw new Error(\"BuildingsOSM subpath export is not a function\");",
                "if (RetrievalLocation.Remote_and_Save !== 2) throw new Error(\"RetrievalLocation enum did not resolve\");",
                "if (EPSG_Type.EPSG_4326 !== 1) throw new Error(\"EPSG_Type enum did not resolve\");",
                "",
                "const math = new TileMath(undefined);",
                "if (math.sign(-3) !== -1 || math.sign(0) !== 0 || math.sign(7) !== 1) {",
                '  throw new Error("TileMath runtime behavior changed");',
                "}",
                "",
                "console.log(\"consumer bundle ok\");",
            ].join("\n"),
        );

        const packOutput = run(
            "npm",
            ["pack", "--json", "--silent", "--pack-destination", consumerDir],
            repoRoot,
        );
        const packInfo = JSON.parse(packOutput.trim())[0];
        if (!packInfo.filename) {
            throw new Error("npm pack did not return a tarball filename");
        }
        const tarballPath = path.join(consumerDir, packInfo.filename);

        run(
            "npm",
            [
                "install",
                "--ignore-scripts",
                "--no-package-lock",
                "--no-fund",
                "--no-audit",
                tarballPath,
                "webpack",
                "webpack-cli",
            ],
            consumerDir,
        );

        run("npx", ["webpack", "--config", "webpack.config.cjs"], consumerDir);

        const bundlePath = path.join(consumerDir, "dist", "bundle.js");
        await readFile(bundlePath, "utf8");
    } finally {
        await rm(consumerDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
