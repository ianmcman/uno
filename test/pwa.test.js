const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const site = path.join(__dirname, '..', 'site');

test('every local script and icon the page uses is precached and exists', () => {
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(site, 'sw.js'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.length >= 5);
  for (const s of scripts) {
    assert.ok(fs.existsSync(path.join(site, s)), s);
    assert.ok(sw.includes(`'/${s}'`), `${s} not precached`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(site, 'manifest.webmanifest'), 'utf8'));
  for (const i of manifest.icons) assert.ok(fs.existsSync(path.join(site, i.src)), i.src);
});
