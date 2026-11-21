import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { text } from "node:stream/consumers";

import { packageDirectory } from "./work-directory.js";

/** Run a staged TypeScript entry with the cached typia plugin. Return its final JSON line or throw with the compiler diagnostics. */
const runEntry = async (
  work: string,
  cacheDirectory: string,
  file: "discovery.ts" | "entry.ts",
): Promise<string> => {
  const ttsx = path.join(packageDirectory("ttsc"), "lib/launcher/ttsx.js");
  const child = spawn(
    process.execPath,
    [
      ttsx,
      "--cache-dir",
      path.join(cacheDirectory, "ttsc"),
      "--project",
      path.join(work, "tsconfig.json"),
      path.join(work, file),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const [stdout, stderr] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    once(child, "close"),
  ]);
  if (child.exitCode !== 0) {
    throw new Error(`The schemas could not be generated.\n${stderr}${stdout}`);
  }
  const output = stdout.trim();
  return output.slice(output.lastIndexOf("\n") + 1);
};

export { runEntry };
