// Build the single-file, emailable distributable.
//
// Reads index.html, replaces the external <script src="vendor/xlsx.full.min.js">
// with an inline <script> containing the library, and writes
// dist/pbl-group-builder.html — one fully self-contained, offline file.
//
// Run:  node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const lib = readFileSync('vendor/xlsx.full.min.js', 'utf8');

const tag = '<script src="vendor/xlsx.full.min.js"></script>';
if (!html.includes(tag)) {
  console.error('Could not find the vendor <script src> tag in index.html — aborting.');
  process.exit(1);
}

// Guard against an accidental </script> inside the library text breaking the tag.
const safeLib = lib.replace(/<\/script>/gi, '<\\/script>');
const inlined = html.replace(tag, `<script>\n${safeLib}\n</script>`);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/pbl-group-builder.html', inlined);

const kb = Math.round(Buffer.byteLength(inlined) / 1024);
console.log(`Wrote dist/pbl-group-builder.html (${kb} KB) — single self-contained file.`);
