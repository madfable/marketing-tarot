// Runs scripts/resize-cards.py with whichever Python this machine has (python3, then python),
// passing any arguments through. Exists so `npm run cards` works on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const script = join(dirname(fileURLToPath(import.meta.url)), "resize-cards.py");
const args = ["-I", script, ...process.argv.slice(2)];

for (const exe of ["python3", "python"]) {
  const probe = spawnSync(exe, ["--version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) continue;
  const run = spawnSync(exe, args, { stdio: "inherit" });
  process.exit(run.status ?? 1);
}

console.error("Python 3 with Pillow is needed for the resize step (pip install pillow). Neither python3 nor python was found.");
process.exit(1);
