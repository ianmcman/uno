const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createServer } = require('../server/server.js');
const { createRoomStore } = require('../server/rooms.js');

async function withServer(fn, store = createRoomStore()) {
  const s = createServer({ store, staticDir: path.join(__dirname, '..', 'site') });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.closeAllConnections(); s.close(); }
}
const post = (base, url, body, token) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) }, body: JSON.stringify(body || {}) });

test('serves the page, scripts and health check', () => withServer(async base => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Uno/);
  assert.equal((await fetch(base + '/game.js')).status, 200);
  assert.equal(await (await fetch(base + '/healthz')).text(), 'ok');
  assert.match((await fetch(base + '/')).headers.get('content-security-policy'), /default-src 'self'/);
}));

test('blocks traversal and bad encoding', () => withServer(async base => {
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
}));

test('create, join, start and play over HTTP', () => withServer(async base => {
  const c = await (await post(base, '/api/rooms', { name: 'Ann' })).json();
  assert.match(c.code, /^[A-Z2-9]{4}$/);
  const j = await (await post(base, `/api/rooms/${c.code}/join`, { name: 'Bob' })).json();
  assert.equal((await post(base, `/api/rooms/${c.code}/start`, {}, j.token)).status, 409);   // only the host
  assert.equal((await post(base, `/api/rooms/${c.code}/start`, {}, c.token)).status, 200);
  assert.equal((await post(base, `/api/rooms/${c.code}/act`, { type: 'draw' }, j.token)).status, 409);   // not Bob's turn
  assert.equal((await post(base, `/api/rooms/${c.code}/act`, { type: 'draw' }, c.token)).status, 200);
  assert.equal((await post(base, `/api/rooms/${c.code}/act`, { type: 'bogus' }, c.token)).status, 400);
}));

test('the event stream sends the player view and never other players\' tokens', () => withServer(async base => {
  const c = await (await post(base, '/api/rooms', { name: 'Ann' })).json();
  const res = await fetch(`${base}/api/rooms/${c.code}/events?watch=${c.watch}`);
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const text = new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  const view = JSON.parse(text.replace(/^data: /, ''));
  assert.equal(view.phase, 'lobby');
  assert.equal(view.you, 0);
  assert.ok(!text.includes(c.token) && !text.includes(c.watch));
  assert.equal((await fetch(`${base}/api/rooms/${c.code}/events`)).status, 403);
  assert.equal((await fetch(`${base}/api/rooms/${c.code}/events?watch=${c.token}`)).status, 403);   // the action token is not a stream token
  assert.equal((await fetch(`${base}/api/rooms/ZZZZ/events?watch=x`)).status, 403);        // same answer as a wrong token
}));

test('rejects oversized and malformed bodies', () => withServer(async base => {
  assert.equal((await post(base, '/api/rooms', { name: 'x'.repeat(9000) })).status, 413);
  const bad = await fetch(base + '/api/rooms', { method: 'POST', body: '{nope' });
  assert.equal(bad.status, 400);
}));

test('room creation and joins are rate limited per client address', async () => {
  const store = createRoomStore();
  const s = createServer({ store, staticDir: path.join(__dirname, '..', 'site'), createLimit: 2, joinLimit: 3 });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${s.address().port}`;
    const a = await (await post(base, '/api/rooms', { name: 'A' })).json();
    assert.equal((await post(base, '/api/rooms', { name: 'B' })).status, 201);
    assert.equal((await post(base, '/api/rooms', { name: 'C' })).status, 429);
    for (let i = 0; i < 3; i++) await post(base, '/api/rooms/ZZZZ/join', { name: 'x' });
    assert.equal((await post(base, `/api/rooms/${a.code}/join`, { name: 'Z' })).status, 429);
  } finally { s.closeAllConnections(); s.close(); }
});

test('failed token lookups are limited and a missing room looks like a wrong token', async () => {
  const store = createRoomStore();
  const s = createServer({ store, staticDir: path.join(__dirname, '..', 'site'), joinLimit: 3 });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${s.address().port}`;
    const a = await (await post(base, '/api/rooms', { name: 'A' })).json();
    const seen = [];
    for (let i = 0; i < 3; i++) seen.push((await post(base, '/api/rooms/ZZZZ/act', { type: 'draw' }, 'x')).status);
    seen.push((await post(base, `/api/rooms/${a.code}/act`, { type: 'draw' }, 'wrong')).status);
    assert.deepEqual(seen, [403, 403, 403, 429]);
    assert.equal((await post(base, `/api/rooms/${a.code}/act`, { type: 'draw' }, a.token)).status, 409);    // a valid token is never refused: this room is still in its lobby
  } finally { s.closeAllConnections(); s.close(); }
});

test('a blocked client does not use up the shared room-creation cap', async () => {
  const store = createRoomStore();
  const s = createServer({ store, staticDir: path.join(__dirname, '..', 'site'), createLimit: 1 });   // 20 shared, 1 per address
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${s.address().port}`;
    assert.equal((await post(base, '/api/rooms', { name: 'A' })).status, 201);
    for (let i = 0; i < 30; i++) assert.equal((await post(base, '/api/rooms', { name: 'B' })).status, 429);
    assert.equal(store.create('direct').code.length, 4);          // the store itself still has room
  } finally { s.closeAllConnections(); s.close(); }
});
