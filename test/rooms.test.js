const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomStore } = require('../server/rooms.js');
const G = require('../site/game.js');

const seeded = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function room(seed = 1) {
  const s = createRoomStore({ rng: seeded(seed) });
  const a = s.create('Ann');
  const b = s.join(a.code, 'Bob');
  s.start(a.code, a.token);
  return { s, code: a.code, A: a.token, B: b.token, AW: a.watch, BW: b.watch };
}

test('only the host starts, and needs two players', () => {
  const s = createRoomStore();
  const a = s.create('Ann');
  assert.throws(() => s.start(a.code, a.token), /at least 2/);
  const b = s.join(a.code, 'Bob');
  assert.throws(() => s.start(a.code, b.token), /host/);
  s.start(a.code, a.token);
  assert.throws(() => s.join(a.code, 'Cy'), /in progress/);
});

test('room holds four players', () => {
  const s = createRoomStore();
  const a = s.create('A');
  ['B', 'C', 'D'].forEach(n => s.join(a.code, n));
  assert.throws(() => s.join(a.code, 'E'), /full/);
});

test('names are trimmed and limited', () => {
  const s = createRoomStore();
  assert.throws(() => s.create('   '), /empty/);
  const a = s.create('  ' + 'x'.repeat(30));
  assert.equal(s.view(a.code, a.watch).players[0].name.length, 20);
});

test('each player sees their own hand and only counts for the others', () => {
  const { s, code, AW, BW } = room();
  const va = s.view(code, AW).game, vb = s.view(code, BW).game;
  assert.equal(va.hand.length, 7);
  assert.equal(vb.hand.length, 7);
  assert.notDeepEqual(va.hand, vb.hand);
  assert.deepEqual(va.players.map(p => p.count), [7, 7]);
  const json = JSON.stringify(va);
  assert.ok(!json.includes('"draw":['), 'draw pile order must not be sent');
  assert.equal(va.hands, undefined);
  assert.equal(typeof va.drawCount, 'number');
});

test('turn order is enforced for play, draw and pass', () => {
  const { s, code, A, B } = room();
  assert.throws(() => s.act(code, B, { type: 'draw' }), /Not your turn/);
  assert.throws(() => s.act(code, B, { type: 'play', index: 0 }), /Not your turn/);
  assert.throws(() => s.act(code, A, { type: 'pass' }), /Draw a card first/);
  s.act(code, A, { type: 'draw' });
  assert.throws(() => s.act(code, A, { type: 'bogus' }), /Unknown/);
});

test('a player can play a legal card by index and the turn moves on', () => {
  for (let seed = 1; seed < 40; seed++) {
    const { s, code, A, AW, BW } = room(seed);
    const v = s.view(code, AW).game;
    const i = v.hand.findIndex(c => c[0] !== 'W' && !'SRDF'.includes(c[1]) && G.canPlay(c, v.top, v.color, v.hand));
    if (i < 0) continue;
    s.act(code, A, { type: 'play', index: i });
    const after = s.view(code, BW).game;
    assert.equal(after.current, 1);
    assert.equal(after.top, v.hand[i]);
    assert.equal(after.players[0].count, 6);
    return;
  }
  assert.fail('no seed gave a plain playable card');
});

test('an illegal card is rejected and leaves the hand alone', () => {
  for (let seed = 1; seed < 40; seed++) {
    const { s, code, A, AW } = room(seed);
    const v = s.view(code, AW).game;
    const i = v.hand.findIndex(c => !G.canPlay(c, v.top, v.color, v.hand));
    if (i < 0) continue;
    assert.throws(() => s.act(code, A, { type: 'play', index: i }), /match|Wild Draw Four/);
    assert.equal(s.view(code, AW).game.hand.length, 7);
    return;
  }
  assert.fail('no seed gave an unplayable card');
});

test('anyone can call Uno or catch out of turn; bad calls are refused', () => {
  const { s, code, A, B } = room();
  assert.throws(() => s.act(code, B, { type: 'catch' }), /Nobody/);
  assert.throws(() => s.act(code, B, { type: 'uno' }), /Nothing to call/);
  assert.throws(() => s.act(code, A, { type: 'play', index: 99 }), /No such card/);
});

test('invalid tokens and unknown rooms', () => {
  const { s, code } = room();
  assert.throws(() => s.view(code, 'nope'), /Invalid token/);
  assert.throws(() => s.view('ZZZZ', 'x'), /not found/);
});

test('sweep removes idle rooms', () => {
  let t = 0;
  const s = createRoomStore({ now: () => t });
  const a = s.create('Ann');
  t = 3 * 60 * 60 * 1000;
  s.sweep();
  assert.throws(() => s.view(a.code, a.watch), /not found/);
});

test('the action token does not open the event stream, and idle lobbies are swept early', () => {
  let t = 0;
  const s = createRoomStore({ now: () => t });
  const a = s.create('Ann');
  assert.throws(() => s.view(a.code, a.token), /Invalid token/);
  t = 31 * 60 * 1000;
  s.sweep();
  assert.throws(() => s.view(a.code, a.watch), /not found/);
});
