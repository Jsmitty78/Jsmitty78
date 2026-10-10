import { readFile } from 'node:fs/promises';
import { checkSchema, RuleContextSchema, SfProjectFactsSchema, resolveSfNfpa13Edition } from '../packages/core/src/index.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: pnpm rules:sf-basis <project-basis.json>');
  process.exitCode = 1;
} else {
  try {
    const input: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
    if (!input || typeof input !== 'object' || !('facts' in input) || !('context' in input)
      || !checkSchema(SfProjectFactsSchema, input.facts) || !checkSchema(RuleContextSchema, input.context)) {
      throw new Error('Invalid project facts or evidence context. See docs/san-francisco-basis.example.json.');
    }
    console.log(JSON.stringify(resolveSfNfpa13Edition(input.facts, input.context), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unable to resolve project basis.');
    process.exitCode = 1;
  }
}
