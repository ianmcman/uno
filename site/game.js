(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UnoGame = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // A card is two characters: colour (R Y G B, or W for wild) then value (0-9, S skip, R reverse, D draw two, W wild, F wild draw four).
  const COLORS = ['R', 'Y', 'G', 'B'];
  const HAND = 7;

  function deck() {
    const cards = [];
    for (const c of COLORS) {
      cards.push(c + '0');
      for (const v of '123456789SRD') cards.push(c + v, c + v);
    }
    for (let i = 0; i < 4; i++) cards.push('WW', 'WF');
    return cards;
  }

  function shuffle(list, rng = Math.random) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  const isWild = card => card[0] === 'W';
  const isNumber = card => card[1] >= '0' && card[1] <= '9';

  function newGame(names, rng = Math.random) {
    if (!names || names.length < 2) throw new Error('Uno needs at least 2 players');
    const draw = shuffle(deck(), rng);
    const players = names.map(name => ({ name, hand: [], uno: false }));
    for (let r = 0; r < HAND; r++) for (const p of players) p.hand.push(draw.pop());
    // The first card has to be a plain number; anything else goes to the bottom.
    while (!isNumber(draw[draw.length - 1])) draw.unshift(draw.pop());
    const top = draw.pop();
    return {
      players,
      draw,
      discard: [top],
      current: 0,
      dir: 1,
      color: top[0],
      drawn: false,         // the current player drew a playable card and may still play it or pass
      vulnerable: null,     // a player left on one card without calling Uno; anyone else may catch them
      phase: 'play',        // play | over
      winner: null,
      lastEvent: null
    };
  }

  const isOver = g => g.phase === 'over';
  const top = g => g.discard[g.discard.length - 1];
  const nextIndex = (g, from, steps = 1) => ((from + g.dir * steps) % g.players.length + g.players.length) % g.players.length;

  function canPlay(card, topCard, color, hand) {
    if (card === 'WF') return !hand.some(c => !isWild(c) && c[0] === color);   // draw four only with no card of the current colour
    if (isWild(card)) return true;
    return card[0] === color || card[1] === topCard[1];
  }

  function takeCards(g, p, n, rng) {
    for (let i = 0; i < n; i++) {
      if (!g.draw.length) {
        if (g.discard.length < 2) return i;
        const keep = g.discard.pop();
        g.draw = shuffle(g.discard, rng);
        g.discard = [keep];
      }
      p.hand.push(g.draw.pop());
    }
    return n;
  }

  function endTurn(g, skip = 0) {
    g.drawn = false;
    g.current = nextIndex(g, g.current, 1 + skip);
  }

  function play(g, index, color, rng = Math.random) {
    if (g.phase !== 'play') throw new Error('The game is over');
    const p = g.players[g.current];
    if (!Number.isInteger(index) || index < 0 || index >= p.hand.length) throw new Error('No such card');
    if (g.drawn && index !== p.hand.length - 1) throw new Error('You can only play the card you drew');
    const card = p.hand[index];
    if (!canPlay(card, top(g), g.color, p.hand)) throw new Error(card === 'WF' ? 'Wild Draw Four only works with no card of the current colour' : "That card doesn't match");
    if (isWild(card) && !COLORS.includes(color)) throw new Error('Choose a colour');

    g.vulnerable = null;
    p.hand.splice(index, 1);
    g.discard.push(card);
    g.color = isWild(card) ? color : card[0];
    const event = { type: 'play', player: g.current, card, color: g.color };
    g.lastEvent = event;

    if (p.hand.length === 0) {
      g.phase = 'over';
      g.winner = g.current;
      g.drawn = false;
      return g;
    }
    if (p.hand.length === 1 && !p.uno) g.vulnerable = g.current;
    p.uno = false;

    const v = card[1];
    const victim = nextIndex(g, g.current);
    if (v === 'R') {
      if (g.players.length === 2) endTurn(g, 1);                 // with two players a reverse is a skip
      else { g.dir = -g.dir; endTurn(g); }
    } else if (v === 'S') {
      endTurn(g, 1);
    } else if (v === 'D' || v === 'F') {
      const n = v === 'D' ? 2 : 4;
      takeCards(g, g.players[victim], n, rng);
      g.players[victim].uno = false;
      event.penalty = { player: victim, n };
      endTurn(g, 1);
    } else {
      endTurn(g);
    }
    return g;
  }

  function draw(g, rng = Math.random) {
    if (g.phase !== 'play') throw new Error('The game is over');
    if (g.drawn) throw new Error('You already drew this turn');
    const p = g.players[g.current];
    g.vulnerable = null;
    p.uno = false;
    const got = takeCards(g, p, 1, rng);
    g.lastEvent = { type: 'draw', player: g.current, n: got };
    if (got && canPlay(p.hand[p.hand.length - 1], top(g), g.color, p.hand)) g.drawn = true;
    else endTurn(g);
    return g;
  }

  function pass(g) {
    if (g.phase !== 'play') throw new Error('The game is over');
    if (!g.drawn) throw new Error('Draw a card first');
    g.lastEvent = { type: 'pass', player: g.current };
    endTurn(g);
    return g;
  }

  // Say Uno: with two cards before playing one, or right after playing down to one while nobody has caught you.
  function callUno(g, who) {
    const p = g.players[who];
    if (!p || g.phase !== 'play') throw new Error('Cannot call Uno now');
    if (g.vulnerable === who) {
      g.vulnerable = null;
      g.lastEvent = { type: 'uno', player: who };
    } else if (who === g.current && p.hand.length === 2) {
      p.uno = true;
      g.lastEvent = { type: 'uno', player: who };
    } else {
      throw new Error('Nothing to call yet');
    }
    return g;
  }

  function catchUno(g, by, rng = Math.random) {
    if (g.phase !== 'play' || g.vulnerable === null) throw new Error('Nobody to catch');
    if (by === g.vulnerable) throw new Error("You can't catch yourself");
    const victim = g.vulnerable;
    g.vulnerable = null;
    takeCards(g, g.players[victim], 2, rng);
    g.lastEvent = { type: 'catch', player: by, victim, n: 2 };
    return g;
  }

  // What one player may see: their own hand, the others' card counts, and nothing about the draw pile order.
  function viewFor(g, you) {
    return {
      players: g.players.map(p => ({ name: p.name, count: p.hand.length, bot: p.bot ? true : undefined })),
      you,
      hand: g.players[you].hand.slice(),
      uno: g.players[you].uno,
      current: g.current,
      dir: g.dir,
      color: g.color,
      top: top(g),
      drawCount: g.draw.length,
      drawn: g.drawn,
      vulnerable: g.vulnerable,
      phase: g.phase,
      winner: g.winner,
      lastEvent: g.lastEvent,
      hands: g.phase === 'over' ? g.players.map(p => p.hand.slice()) : undefined     // everything is revealed once the game ends
    };
  }

  const POINTS = { S: 20, R: 20, D: 20, W: 50, F: 50 };
  const cardPoints = card => (isNumber(card) ? Number(card[1]) : POINTS[card[1]]);
  const handPoints = hand => hand.reduce((sum, c) => sum + cardPoints(c), 0);

  return { COLORS, HAND, deck, shuffle, isWild, isNumber, newGame, isOver, top, canPlay, play, draw, pass, callUno, catchUno, viewFor, cardPoints, handPoints };
});
