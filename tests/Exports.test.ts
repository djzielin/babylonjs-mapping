import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("package exports", () => {
  it("supports ESM imports from the package root and compatibility subpaths", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "babylonjs-mapping-exports-"));

    try {
      mkdirSync(join(tempDir, "node_modules"), { recursive: true });
      symlinkSync(repoRoot, join(tempDir, "node_modules", "babylonjs-mapping"), "dir");
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ type: "module" }));

      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
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
          `,
        ],
        { cwd: tempDir, stdio: "pipe" },
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
