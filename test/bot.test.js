const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../site/game.js');
const B = require('../site/bot.js');

function game(hands, topCard) {
  const g = G.newGame(hands.map((_, i) => 'P' + i), () => 0.5);
  hands.forEach((h, i) => { g.players[i].hand = h.slice(); });
  g.discard = [topCard]; g.color = topCard[0]; g.current = 0; g.dir = 1; g.drawn = false; g.vulnerable = null;
  return g;
}

test('the bot draws when nothing matches and plays something legal otherwise', () => {
  assert.equal(B.choosePlay(game([['B1', 'G2'], ['R1']], 'R9')), -1);
  const g = game([['B1', 'R2', 'G9'], ['R1', 'R2']], 'R9');
  const i = B.choosePlay(g);
  assert.ok(G.canPlay(g.players[0].hand[i], 'R9', 'R', g.players[0].hand));
});

test('it keeps wilds while it has other options, and uses them when stuck low', () => {
  assert.equal(B.choosePlay(game([['WW', 'R2', 'B3', 'B4', 'B5'], ['R1', 'R2', 'R3']], 'R9')), 1);
  const g = game([['WW', 'B3'], ['R1', 'R2', 'R3']], 'R9');
  assert.equal(g.players[0].hand[B.choosePlay(g)], 'WW');
});

test('with an opponent nearly out, it prefers a skip or draw card', () => {
  const g = game([['R8', 'RS'], ['R1', 'R2']], 'R9');
  assert.equal(g.players[0].hand[B.choosePlay(g)], 'RS');
});

test('it picks the colour it holds most', () => {
  const g = game([['WW', 'B1', 'B2', 'G1'], ['R1']], 'R9');
  assert.equal(B.chooseColor(g, 0), 'B');
});

test('after drawing, only the drawn card is considered', () => {
  const g = game([['R1', 'R2', 'B7'], ['G1']], 'R9');
  g.drawn = true;
  assert.equal(B.choosePlay(g), -1, 'the drawn card B7 does not match, even though R1 does');
});

test('bots finish whole games', () => {
  for (let s = 0; s < 20; s++) {
    const g = G.newGame(['a', 'b', 'c']);
    for (let n = 0; n < 4000 && !G.isOver(g); n++) {
      const i = B.choosePlay(g);
      if (i >= 0) G.play(g, i, G.isWild(g.players[g.current].hand[i]) ? B.chooseColor(g, i) : undefined);
      else if (g.drawn) G.pass(g); else G.draw(g);
    }
    assert.ok(G.isOver(g));
  }
});
