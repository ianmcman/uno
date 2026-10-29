(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'));
  else root.UnoBot = factory(root.UnoGame);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (G) {
  // The colour the bot holds the most of, for choosing after a wild.
  function bestColor(hand) {
    const n = { R: 0, Y: 0, G: 0, B: 0 };
    for (const c of hand) if (n[c[0]] !== undefined) n[c[0]]++;
    return G.COLORS.reduce((a, b) => (n[b] > n[a] ? b : a));
  }

  // Index of the card to play, or -1 to draw. After a draw the only candidate is the last card.
  function choosePlay(g) {
    const p = g.players[g.current];
    const t = G.top(g);
    const next = g.players[(g.current + g.dir + g.players.length) % g.players.length];
    const squeeze = next.hand.length <= 2;
    let best = -1, bv = -Infinity;
    p.hand.forEach((card, i) => {
      if (g.drawn && i !== p.hand.length - 1) return;
      if (!G.canPlay(card, t, g.color, p.hand)) return;
      const action = 'SRDF'.includes(card[1]);
      let v = G.cardPoints(card);
      if (G.isWild(card)) v = p.hand.length <= 3 ? 30 : -20;           // keep wilds for later unless the game is nearly over
      else if (action) v += squeeze ? 60 : 10;
      if (card[0] === bestColor(p.hand.filter((_, j) => j !== i))) v += 3;
      if (v > bv) { bv = v; best = i; }
    });
    return best;
  }

  function chooseColor(g, index) {
    const p = g.players[g.current];
    return bestColor(p.hand.filter((_, j) => j !== index));
  }

  return { choosePlay, chooseColor, bestColor };
});
