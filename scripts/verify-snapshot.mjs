import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const base = resolve("projects/sprink-source");
const manifest = JSON.parse(readFileSync(resolve(base, "SOURCE-MANIFEST.json"), "utf8"));
const errors = [];
for (const entry of manifest.files) {
  const path = resolve(base, entry.path);
  if (!path.startsWith(base + sep)) {
    errors.push(`Invalid manifest path: ${entry.path}`);
    continue;
  }
  try {
    const bytes = readFileSync(path);
    const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (actual !== entry.local_blob_sha) errors.push(`Content differs: ${entry.path}`);
  } catch {
    errors.push(`Cannot read: ${entry.path}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${manifest.files.length} archived files match the recorded local Git blob hashes.`);
  console.log("This verifies snapshot integrity, not source authorship or runtime correctness.");
}
