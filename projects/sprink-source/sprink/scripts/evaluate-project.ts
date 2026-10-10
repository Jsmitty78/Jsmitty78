import { readFileSync } from "node:fs";
import { evaluateProject } from "../packages/core/src/index.js";
import { ProjectInputError } from "../packages/core/src/project-contract.js";

function readInput(): string {
  const path = process.argv[2];
  if (process.argv.length > 3) throw new Error("Usage: pnpm rules:evaluate [input.json|-]");
  if (path && path !== "-") return readFileSync(path, "utf8");
  return readFileSync(0, "utf8");
}

try {
  const input = JSON.parse(readInput()) as unknown;
  process.stdout.write(`${JSON.stringify(evaluateProject(input), null, 2)}\n`);
} catch (error) {
  if (error instanceof ProjectInputError) {
    process.stderr.write(`${JSON.stringify({ error: error.message, code: error.code, paths: error.paths })}\n`);
  } else if (error instanceof SyntaxError) {
    process.stderr.write(`${JSON.stringify({ error: "Input must be valid JSON." })}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
  } else {
    process.stderr.write(`${JSON.stringify({ error: "Project evaluation failed." })}\n`);
  }
  process.exitCode = 1;
}
