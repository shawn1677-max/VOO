#!/usr/bin/env node
// Inlines data/dataset.json into the dashboard source and emits two outputs:
//   dist/artifact.html — page content only, for publishing as a Claude Artifact
//   index.html         — the same page wrapped in a full HTML document, for opening locally
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'dashboard.html'), 'utf8');
const dataset = readFileSync(join(root, 'data', 'dataset.json'), 'utf8').trim();

if (!src.includes('/*__DATASET__*/')) throw new Error('dataset placeholder missing from src/dashboard.html');
// </script> inside JSON would close the host tag early.
const safe = dataset.replace(/<\//g, '<\\/');
const body = src.replace('/*__DATASET__*/', safe);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'artifact.html'), body);

// The artifact host supplies the document skeleton; for the local file, split the
// page content at the first layout element so head material stays in <head>.
const splitAt = body.indexOf('<div class="shell">');
if (splitAt < 0) throw new Error('shell wrapper missing from src/dashboard.html');

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="A dashboard for a monthly VOO position: real tax lots, cost basis, sixteen years of fund history, and a simulated forward path.">
${body.slice(0, splitAt)}</head>
<body>
${body.slice(splitAt)}
</body>
</html>
`;
writeFileSync(join(root, 'index.html'), standalone);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`dist/artifact.html ${kb(body)}\nindex.html         ${kb(standalone)}`);
