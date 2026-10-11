import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const project = new URL('../', import.meta.url);
const repository = new URL('../', project);
const files = [
  ['transit/schedule.json', 'generated/schedule.json'],
  ['src/transit/schedule.ts', 'generated/transit/schedule.ts'],
  ['src/transit/realtime-contract.ts', 'generated/transit/realtime-contract.ts'],
  ['src/core/dates.ts', 'generated/core/dates.ts'],
  ['src/core/geo.ts', 'generated/core/geo.ts'],
];

for (const [source, target] of files) {
  const destination = new URL(target, project);
  await mkdir(new URL('./', destination), { recursive: true });
  await copyFile(new URL(source, repository), destination);
}
console.log(
  `Prepared public schedule and shared domain types in ${fileURLToPath(project)}generated/`,
);
