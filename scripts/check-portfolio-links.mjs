import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const root = process.cwd();
const files = ["README.md", "projects/sprink-source/README.md"];
for (const directory of ["projects", "docs"]) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(`${directory}/${entry.name}`);
  }
}
let checked = 0;
const errors = [];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  const links = content.matchAll(/\]\(([^)]+)\)|(?:href|src)="([^"]+)"/g);
  for (const match of links) {
    const href = match[1] ?? match[2];
    if (/^(?:[a-z]+:|#|\/\/)/i.test(href)) continue;
    const target = decodeURIComponent(href.split(/[?#]/)[0]);
    const absolute = resolve(dirname(resolve(file)), target);
    if (!absolute.startsWith(root + sep) || !existsSync(absolute)) {
      errors.push(`${file}: ${href}`);
    }
    checked++;
  }
}
if (errors.length) {
  console.error("Missing or out-of-repository portfolio targets:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${checked} local link/image targets resolve across ${files.length} maintained Markdown files.`);
  console.log("External URLs and heading fragments are not checked. Archived upstream documentation is excluded.");
}
