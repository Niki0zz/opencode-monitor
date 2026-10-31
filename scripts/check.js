'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skip = new Set(['node_modules', 'dist', '.git', 'build', 'docs']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walk(root);
for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

for (const json of ['package.json', 'lib/pricing.json', 'package-lock.json']) {
  JSON.parse(fs.readFileSync(path.join(root, json), 'utf8').replace(/^\uFEFF/, ''));
}

console.log('Checked ' + files.length + ' JavaScript files and 3 JSON files.');
