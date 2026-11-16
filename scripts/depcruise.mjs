// Run dependency-cruiser in every workspace package with the shared root
// config. The rules use package-relative paths (^src/, ^tests/), so each
// package is cruised from its own directory.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const config = join(root, ".dependency-cruiser.cjs");
const bin = join(root, "node_modules", ".bin", "depcruise");

const packages = JSON.parse(
  execFileSync("pnpm", ["-r", "list", "--depth", "-1", "--json"], {
    encoding: "utf8",
  }),
).filter((p) => p.path !== root && existsSync(join(p.path, "tsconfig.json")));

const failures = [];
for (const { name, path } of packages) {
  console.log(`depcruise: ${name}`);
  // --no-cache: the cache does not notice package.json edits, so it can
  // report stale dependency types (and a false green).
  const { status } = spawnSync(
    bin,
    [
      ".",
      "--config",
      config,
      "--output-type",
      "err",
      "--progress",
      "none",
      "--no-cache",
    ],
    { cwd: path, stdio: "inherit" },
  );
  if (status !== 0) failures.push(name);
}

if (failures.length > 0) {
  console.error(`depcruise failed: ${failures.join(", ")}`);
  process.exit(1);
}
