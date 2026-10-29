const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../site/game.js');

const seeded = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// A hand-built game: players get exactly the hands given, `topCard` is on the discard pile.
function setup(hands, topCard, extra = {}) {
  const g = G.newGame(hands.map((_, i) => 'P' + i), seeded(7));
  hands.forEach((h, i) => { g.players[i].hand = h.slice(); });
  g.discard = [topCard];
  g.color = topCard[0];
  g.current = 0;
  g.dir = 1;
  g.vulnerable = null;
  g.drawn = false;
  g.draw = extra.draw || ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'];
  return g;
}

test('the deck has 108 cards', () => {
  const d = G.deck();
  assert.equal(d.length, 108);
  assert.equal(d.filter(c => c === 'WW').length, 4);
  assert.equal(d.filter(c => c === 'WF').length, 4);
  assert.equal(d.filter(c => c === 'R0').length, 1);
  assert.equal(d.filter(c => c === 'R5').length, 2);
});

test('a new game deals 7 each and starts on a number card', () => {
  for (let s = 1; s < 30; s++) {
    const g = G.newGame(['a', 'b', 'c'], seeded(s));
    assert.deepEqual(g.players.map(p => p.hand.length), [7, 7, 7]);
    assert.ok(G.isNumber(G.top(g)));
    assert.equal(g.color, G.top(g)[0]);
    assert.equal(g.draw.length + g.discard.length + 21, 108);
  }
  assert.throws(() => G.newGame(['solo']), /at least 2/);
});

test('cards match by colour or by value, wilds always', () => {
  assert.ok(G.canPlay('R5', 'R9', 'R', ['R5']));
  assert.ok(G.canPlay('B5', 'R5', 'R', ['B5']));
  assert.ok(!G.canPlay('B6', 'R5', 'R', ['B6']));
  assert.ok(G.canPlay('WW', 'R5', 'R', ['WW', 'R1']));
  assert.ok(G.canPlay('B6', 'W', 'B', ['B6']), 'the chosen colour counts after a wild');
});

test('Wild Draw Four only with no card of the current colour', () => {
  assert.ok(!G.canPlay('WF', 'R5', 'R', ['WF', 'R1']));
  assert.ok(G.canPlay('WF', 'R5', 'R', ['WF', 'B1', 'WW']));
});

test('playing a card moves it to the discard and advances the turn', () => {
  const g = setup([['R5', 'B1'], ['G1', 'G2'], ['Y1', 'Y2']], 'R9');
  G.play(g, 0);
  assert.equal(G.top(g), 'R5');
  assert.equal(g.current, 1);
  assert.equal(g.players[0].hand.length, 1);
});

test('an unplayable card is refused', () => {
  const g = setup([['B5', 'R1'], ['G1', 'G2']], 'R9');
  assert.throws(() => G.play(g, 0), /match/);
  assert.throws(() => G.play(g, 5), /No such card/);
  assert.equal(g.current, 0);
});

test('skip, reverse and draw two', () => {
  let g = setup([['RS', 'R1'], ['G1'], ['Y1']], 'R9');
  G.play(g, 0);
  assert.equal(g.current, 2, 'skip jumps a player');

  g = setup([['RR', 'R1'], ['G1'], ['Y1']], 'R9');
  G.play(g, 0);
  assert.equal(g.dir, -1);
  assert.equal(g.current, 2, 'reverse sends play the other way');

  g = setup([['RR', 'R1'], ['G1']], 'R9');
  G.play(g, 0);
  assert.equal(g.current, 0, 'with two players reverse is a skip');

  g = setup([['RD', 'R1'], ['G1'], ['Y1']], 'R9');
  G.play(g, 0);
  assert.equal(g.players[1].hand.length, 3);
  assert.equal(g.current, 2);
});

test('wild picks the colour; wild draw four also makes the next player draw four', () => {
  let g = setup([['WW', 'R1'], ['G1'], ['Y1']], 'R9');
  assert.throws(() => G.play(g, 0), /colour/);
  G.play(g, 0, 'B');
  assert.equal(g.color, 'B');
  assert.equal(g.current, 1);

  g = setup([['WF', 'B1'], ['G1'], ['Y1']], 'R9');
  G.play(g, 0, 'G');
  assert.equal(g.players[1].hand.length, 5);
  assert.equal(g.current, 2);
  assert.equal(g.color, 'G');
});

test('drawing: a playable card may be played or kept, otherwise the turn ends', () => {
  let g = setup([['B1'], ['G1'], ['Y1']], 'R9', { draw: ['R2'] });
  G.draw(g);
  assert.equal(g.drawn, true);
  assert.equal(g.current, 0);
  assert.throws(() => G.draw(g), /already drew/);
  G.pass(g);
  assert.equal(g.current, 1);
  assert.equal(g.players[0].hand.length, 2);

  g = setup([['B1'], ['G1'], ['Y1']], 'R9', { draw: ['B2'] });
  G.draw(g);
  assert.equal(g.drawn, false);
  assert.equal(g.current, 1, 'an unplayable draw passes the turn');
  assert.throws(() => G.pass(g), /Draw a card first/);
});

test('after drawing only the drawn card can be played', () => {
  const g = setup([['R1', 'B1'], ['G1']], 'R9', { draw: ['R2'] });
  G.draw(g);
  assert.throws(() => G.play(g, 0), /drew/);
  G.play(g, 2);
  assert.equal(G.top(g), 'R2');
});

test('the draw pile is rebuilt from the discards when it runs out', () => {
  const g = setup([['B1'], ['G1']], 'R9', { draw: [] });
  g.discard = ['R1', 'R2', 'R3', 'R9'];
  G.draw(g, seeded(3));
  assert.equal(G.top(g), 'R9');
  assert.equal(g.draw.length + g.discard.length + g.players[0].hand.length, 4 + 1);
  assert.equal(g.players[0].hand.length, 2);
});

test('going out wins the game', () => {
  const g = setup([['R5'], ['G1', 'G2']], 'R9');
  G.play(g, 0);
  assert.ok(G.isOver(g));
  assert.equal(g.winner, 0);
  assert.throws(() => G.draw(g), /over/);
  assert.equal(G.viewFor(g, 1).hands[1].length, 2, 'hands are revealed at the end');
});

test('forgetting Uno can be punished until the next player moves', () => {
  const g = setup([['R5', 'R6'], ['G1', 'G2'], ['Y1', 'Y2']], 'R9');
  G.play(g, 0);
  assert.equal(g.vulnerable, 0);
  assert.throws(() => G.catchUno(g, 0), /yourself/);
  G.catchUno(g, 2, seeded(1));
  assert.equal(g.players[0].hand.length, 3);
  assert.equal(g.vulnerable, null);
  assert.throws(() => G.catchUno(g, 2), /Nobody/);
});

test('calling Uno first, or straight after, avoids the penalty', () => {
  let g = setup([['R5', 'R6'], ['G1', 'G2', 'G3']], 'R9');
  G.callUno(g, 0);
  G.play(g, 0);
  assert.equal(g.vulnerable, null);
  assert.equal(g.players[0].uno, false);

  g = setup([['R5', 'R6'], ['G1', 'G2', 'G3']], 'R9');
  G.play(g, 0);
  assert.equal(g.vulnerable, 0);
  G.callUno(g, 0);
  assert.equal(g.vulnerable, null);
  assert.throws(() => G.callUno(g, 1), /Nothing to call/);
});

test('the next move closes the catch window', () => {
  const g = setup([['R5', 'R6'], ['R1', 'G2', 'G3']], 'R9');
  G.play(g, 0);
  G.play(g, 0);
  assert.equal(g.vulnerable, null);
});

test('a player view hides other hands and the draw order', () => {
  const g = G.newGame(['a', 'b'], seeded(2));
  const v = G.viewFor(g, 0);
  assert.deepEqual(v.hand, g.players[0].hand);
  assert.equal(v.players[1].count, 7);
  assert.equal(v.drawCount, g.draw.length);
  assert.ok(!('draw' in v) && !('discard' in v));
  assert.equal(JSON.stringify(v).includes(g.players[1].hand.join('')), false);
});

test('points: numbers face value, actions 20, wilds 50', () => {
  assert.equal(G.handPoints(['R5', 'BS', 'WF', 'G0', 'WW']), 5 + 20 + 50 + 0 + 50);
});

test('card count is always 108 across a whole random game', () => {
  for (let s = 1; s <= 25; s++) {
    const rng = seeded(s);
    const g = G.newGame(['a', 'b', 'c', 'd'], rng);
    for (let step = 0; step < 4000 && !G.isOver(g); step++) {
      const p = g.players[g.current];
      const i = p.hand.findIndex((c, k) => (!g.drawn || k === p.hand.length - 1) && G.canPlay(c, G.top(g), g.color, p.hand));
      if (i >= 0) G.play(g, i, G.COLORS[Math.floor(rng() * 4)], rng);
      else if (g.drawn) G.pass(g);
      else G.draw(g, rng);
      assert.equal(g.players.reduce((n, q) => n + q.hand.length, 0) + g.draw.length + g.discard.length, 108);
    }
    assert.ok(G.isOver(g), `game ${s} finished`);
  }
});
