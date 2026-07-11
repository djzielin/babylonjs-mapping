import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function assertImportsResolve() {
  return `
    const root = await import("babylonjs-mapping");
    const flat = await import("babylonjs-mapping/lib/RasterOSM");
    const nested = await import("babylonjs-mapping/lib/core/TileSet");

    if (typeof root.TileSet !== "function") {
      throw new Error("package root did not expose TileSet");
    }

    if (typeof flat.default !== "function") {
      throw new Error("compatibility subpath lib/RasterOSM did not resolve");
    }

    if (typeof nested.default !== "function") {
      throw new Error("compatibility subpath lib/core/TileSet did not resolve");
    }
  `;
}

describe("package exports", () => {
  it("supports ESM imports from the package root and compatibility subpaths", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "babylonjs-mapping-exports-"));

    try {
      mkdirSync(join(tempDir, "node_modules"), { recursive: true });
      symlinkSync(repoRoot, join(tempDir, "node_modules", "babylonjs-mapping"), "dir");
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ type: "module" }));

      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", assertImportsResolve()],
        { cwd: tempDir, stdio: "pipe" },
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("supports installation from a packed tarball", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "babylonjs-mapping-pack-"));
    let tarballPath = "";

    try {
      const packed = JSON.parse(
        execFileSync("npm", ["pack", "--json"], { cwd: repoRoot, encoding: "utf8" }),
      ) as Array<{ filename: string }>;

      if (!packed[0]?.filename) {
        throw new Error("npm pack did not return a tarball filename");
      }

      tarballPath = join(repoRoot, packed[0].filename);
      mkdirSync(join(tempDir, "node_modules"), { recursive: true });
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ type: "module" }));

      execFileSync(
        "npm",
        ["install", "--ignore-scripts", "--omit=dev", "--no-fund", "--no-audit", tarballPath],
        { cwd: tempDir, stdio: "pipe" },
      );

      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", assertImportsResolve()],
        { cwd: tempDir, stdio: "pipe" },
      );
    } finally {
      if (tarballPath) {
        rmSync(tarballPath, { force: true });
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
