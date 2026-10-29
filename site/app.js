(function () {
  'use strict';
  const G = window.UnoGame, B = window.UnoBot;
  const KEY_NAMES = 'uno_names', KEY_SAVED = 'uno_saved_game';
  const COLOR_NAME = { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue' };
  const VALUE_NAME = { S: 'Skip', R: 'Reverse', D: 'Draw Two' };
  const SYMBOL = { S: '⊘', R: '⇄', D: '+2', F: '+4' };
  const $ = id => document.getElementById(id);

  let game = null, net = null, botTimer = null, revealed = null, pendingWild = null;
  let note = null;                                  // { text, cls } shown in the status line for one render
  let prevHand = null, prevKey = null;              // to animate only what changed

  const screens = { start: $('screen-start'), online: $('screen-online'), lobby: $('screen-lobby'), game: $('screen-game'), end: $('screen-end') };
  function show(name) { Object.keys(screens).forEach(k => { screens[k].hidden = k !== name; }); }

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* blocked */ } }
  };
  const save = () => (game && !G.isOver(game) ? store.set(KEY_SAVED, game) : store.del(KEY_SAVED));

  const cardName = card => (card === 'WW' ? 'Wild' : card === 'WF' ? 'Wild Draw Four' : `${COLOR_NAME[card[0]]} ${VALUE_NAME[card[1]] || card[1]}`);

  // --- Start screen ---
  function renderInputs(names) {
    const box = $('player-inputs');
    box.innerHTML = '';
    names.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      const input = document.createElement('input');
      input.type = 'text'; input.value = name; input.maxLength = 20; input.placeholder = `Player ${i + 1}`;
      input.setAttribute('aria-label', `Player ${i + 1} name`);
      row.appendChild(input);
      if (names.length > 2) {
        const rm = document.createElement('button');
        rm.type = 'button'; rm.className = 'btn btn-outline'; rm.textContent = '✕';
        rm.setAttribute('aria-label', `Remove player ${i + 1}`);
        rm.addEventListener('click', () => { const v = values(); v.splice(i, 1); renderInputs(v); });
        row.appendChild(rm);
      }
      box.appendChild(row);
    });
    $('btn-add').disabled = names.length >= 4;
  }
  const values = () => [...document.querySelectorAll('#player-inputs input')].map(i => i.value);
  function cleanNames() { return values().map((n, i) => n.trim() || `Player ${i + 1}`).slice(0, 4); }
  const savedNames = () => { const s = store.get(KEY_NAMES); return Array.isArray(s) && s.length >= 2 && s.length <= 4 ? s : ['Player 1', 'Player 2']; };

  function checkResume() {
    const s = store.get(KEY_SAVED);
    const ok = s && Array.isArray(s.players) && s.players.length >= 2 && s.phase === 'play';
    $('resume-banner').hidden = !ok;
    if (ok) $('resume-details').textContent = s.players.map(p => `${p.name} ${p.hand.length}`).join(', ');
  }

  function resetView() { revealed = null; pendingWild = null; note = null; prevHand = null; prevKey = null; clearTimeout(botTimer); botTimer = null; }

  function start(names, botIndex) {
    game = G.newGame(names);
    if (botIndex !== undefined) game.players[botIndex].bot = true;
    resetView();
    save(); show('game'); render();
  }

  // --- Views ---
  const humans = () => game.players.filter(p => !p.bot).length;
  const covered = () => !net && game && humans() > 1 && revealed !== game.current && game.phase === 'play';
  function view() {
    if (net) return net.view;
    const you = humans() > 1 ? game.current : game.players.findIndex(p => !p.bot);
    return G.viewFor(game, you);
  }

  // --- Rendering ---
  function cardEl(card, tag) {
    const el = document.createElement(tag || 'div');
    if (tag === 'button') el.type = 'button';
    el.className = `uc c-${card[0]}${card[0] === 'W' ? ' wild' : ''}`;
    const face = SYMBOL[card[1]] || (card === 'WW' ? '' : card[1]);
    const mid = document.createElement('span'); mid.className = 'uc-mid'; mid.textContent = face;
    const tl = document.createElement('span'); tl.className = 'uc-corner tl'; tl.textContent = face;
    const br = document.createElement('span'); br.className = 'uc-corner br'; br.textContent = face;
    el.append(tl, mid, br);
    el.setAttribute('aria-label', cardName(card));
    return el;
  }

  function eventText(v) {
    const e = v.lastEvent;
    if (!e) return '';
    const name = i => v.players[i].name;
    switch (e.type) {
      case 'play': {
        let t = `${name(e.player)} played ${cardName(e.card)}${e.card[0] === 'W' ? ` (${COLOR_NAME[e.color]})` : ''}.`;
        if (e.penalty) t += ` ${name(e.penalty.player)} draws ${e.penalty.n}.`;
        if (v.players[e.player].count === 1 && v.vulnerable !== e.player && v.phase === 'play') t += ' Uno!';
        return t;
      }
      case 'draw': return e.n ? `${name(e.player)} drew a card.` : `${name(e.player)} can't draw: the pile is empty.`;
      case 'pass': return `${name(e.player)} passed.`;
      case 'uno': return `${name(e.player)} called Uno!`;
      case 'catch': return `${name(e.player)} caught ${name(e.victim)} without Uno. ${name(e.victim)} draws ${e.n}.`;
      default: return '';
    }
  }

  function render() {
    if (!game && !net) return;
    const v = view();
    const hidden = covered();
    const me = v.you, myTurn = v.phase === 'play' && v.current === me && !hidden;
    const hotSeat = !net && humans() > 1;
    if (!myTurn) pendingWild = null;

    // scoreboard
    const sb = $('scoreboard');
    sb.innerHTML = '';
    v.players.forEach((p, i) => {
      const c = document.createElement('div');
      c.className = 'chip' + (i === v.current ? ' turn' : '');
      const n = document.createElement('span'); n.className = 'chip-name'; n.textContent = p.name + (net && i === me ? ' (you)' : '');
      const t = document.createElement('span'); t.className = 'chip-total'; t.textContent = String(p.count);
      c.append(n, t);
      const sub = document.createElement('span'); sub.className = 'chip-off';
      sub.textContent = p.count === 1 ? 'UNO' : 'cards';
      if (p.count === 1) c.classList.add('uno');
      c.appendChild(sub);
      sb.appendChild(c);
    });

    // table
    const pile = $('draw-pile');
    pile.replaceChildren(Object.assign(document.createElement('span'), { className: 'uc-back-label', textContent: 'UNO' }), Object.assign(document.createElement('small'), { textContent: String(v.drawCount) }));
    pile.disabled = !myTurn || v.drawn;
    const key = JSON.stringify(v.lastEvent) + v.drawCount;
    const disc = $('discard');
    disc.replaceChildren();
    const topEl = cardEl(v.top);
    if (prevKey !== null && key !== prevKey && v.lastEvent && v.lastEvent.type === 'play') topEl.classList.add('pop');
    disc.appendChild(topEl);
    prevKey = key;
    $('color-dot').className = `color-dot c-${v.color}`;
    $('color-name').textContent = COLOR_NAME[v.color];
    $('dir').textContent = v.dir === 1 ? '↻' : '↺';

    // status
    let text = '', cls = '';
    const turn = myTurn
      ? (v.drawn ? 'Play the card you drew, or keep it and pass.' : (hotSeat ? `${v.players[me].name}, your turn.` : 'Your turn.'))
      : (hidden ? '' : `${v.players[v.current].name} is playing…`);
    if (pendingWild !== null) text = 'Choose the next colour.';
    else if (note) { text = note.text; cls = note.cls; }
    else text = [eventText(v), turn].filter(Boolean).join(' ');
    if (!note && v.lastEvent && (v.lastEvent.type === 'catch')) cls = 'bad';
    $('status').textContent = text; $('status').className = 'status ' + cls;
    note = null;

    // actions
    $('color-pick').hidden = pendingWild === null || !myTurn;
    const canCall = !hidden && v.phase === 'play' && ((v.current === me && v.hand.length === 2 && !v.uno) || v.vulnerable === me);
    $('btn-uno').hidden = hidden || v.phase !== 'play' || !(canCall || (v.current === me && v.hand.length === 2 && v.uno));
    $('btn-uno').disabled = !canCall;
    $('btn-uno').textContent = canCall ? 'Uno!' : 'Uno called';
    $('btn-uno').classList.toggle('btn-hot', canCall);
    $('btn-catch').hidden = hidden || v.vulnerable === null || v.vulnerable === me;
    $('btn-catch').textContent = v.vulnerable === null ? 'Catch' : `Catch ${v.players[v.vulnerable].name}`;
    $('btn-pass').hidden = !(myTurn && v.drawn);

    // hand
    const handEl = $('hand');
    handEl.replaceChildren();
    handEl.hidden = hidden;
    $('cover').hidden = !hidden;
    if (hidden) $('cover-text').textContent = `Pass the device to ${game.players[game.current].name}.`;
    else {
      const counts = new Map();
      v.hand.forEach(c => counts.set(c, (counts.get(c) || 0) + 1));
      const seen = new Map();
      const order = v.hand.map((card, i) => ({ card, i })).sort((a, b) => ('RYGBW'.indexOf(a.card[0]) - 'RYGBW'.indexOf(b.card[0])) || (a.card < b.card ? -1 : a.card > b.card ? 1 : a.i - b.i));
      order.forEach(({ card, i }) => {
        const el = cardEl(card, 'button');
        const ok = myTurn && (!v.drawn || i === v.hand.length - 1) && G.canPlay(card, v.top, v.color, v.hand);
        el.disabled = !ok;
        el.classList.add(ok ? 'playable' : 'dim');
        if (pendingWild === i) el.classList.add('chosen');
        const n = (seen.get(card) || 0) + 1; seen.set(card, n);
        if (prevHand && prevHand.who === me && n > (prevHand.counts.get(card) || 0)) el.classList.add('deal');
        el.addEventListener('click', () => choose(i));
        handEl.appendChild(el);
      });
      prevHand = { who: me, counts };
    }
    maybeBot();
  }

  // --- Actions ---
  function local(fn) {
    try { fn(); } catch (err) { note = { text: err.message, cls: 'bad' }; }
    save();
    if (G.isOver(game)) { endScreen(); return; }
    render();
  }
  function act(action) {
    if (net) { net.send(action); return; }
    local(() => {
      switch (action.type) {
        case 'play': G.play(game, action.index, action.color); break;
        case 'draw': G.draw(game); break;
        case 'pass': G.pass(game); break;
        case 'uno': G.callUno(game, view().you); break;
        case 'catch': G.catchUno(game, view().you); break;
      }
    });
  }

  function choose(i) {
    const v = view();
    if (G.isWild(v.hand[i])) { pendingWild = i; render(); return; }
    act({ type: 'play', index: i });
  }
  $('color-pick').addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (!b || pendingWild === null) return;
    const index = pendingWild;
    pendingWild = null;
    act({ type: 'play', index, color: b.dataset.color });
  });
  $('btn-color-cancel').addEventListener('click', () => { pendingWild = null; render(); });
  $('draw-pile').addEventListener('click', () => { pendingWild = null; act({ type: 'draw' }); });
  $('btn-pass').addEventListener('click', () => act({ type: 'pass' }));
  $('btn-uno').addEventListener('click', () => act({ type: 'uno' }));
  $('btn-catch').addEventListener('click', () => act({ type: 'catch' }));
  $('btn-reveal').addEventListener('click', () => { revealed = game.current; render(); });

  // --- Bot ---
  function maybeBot() {
    if (net || botTimer || !game || screens.game.hidden || game.phase !== 'play' || !game.players[game.current].bot) return;
    const ref = game;
    botTimer = setTimeout(() => {
      botTimer = null;
      if (game === ref && !screens.game.hidden) botStep();
    }, 1000);
  }
  function botStep() {
    const g = game, p = g.players[g.current];
    if (g.vulnerable !== null && !g.players[g.vulnerable].bot && Math.random() < 0.8) {   // the bot catches a human who forgot, most of the time
      local(() => G.catchUno(g, g.current));
      return;
    }
    local(() => {
      const i = B.choosePlay(g);
      if (i >= 0) {
        if (p.hand.length === 2 && Math.random() < 0.85) G.callUno(g, g.current);       // and sometimes forgets itself
        G.play(g, i, G.isWild(p.hand[i]) ? B.chooseColor(g, i) : undefined);
      } else if (g.drawn) G.pass(g);
      else G.draw(g);
    });
  }

  // --- End ---
  function endScreen() {
    const v = view();
    const online = Boolean(net);
    $('btn-again').hidden = online;
    $('btn-setup').hidden = online;
    $('btn-leave-end').hidden = !online;
    const hands = v.hands || v.players.map(() => []);
    $('winner-text').textContent = `${v.players[v.winner].name} wins!`;
    const rows = v.players.map((p, i) => ({ name: p.name, cards: hands[i].length, points: G.handPoints(hands[i]), won: i === v.winner }));
    rows.sort((a, b) => (b.won - a.won) || (a.points - b.points));
    const body = $('standings');
    body.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      [String(i + 1), r.name, String(r.cards), String(r.points)].forEach(t => { const td = document.createElement('td'); td.textContent = t; tr.appendChild(td); });
      body.appendChild(tr);
    });
    clearTimeout(botTimer); botTimer = null;
    show('end');
  }

  // --- Wiring ---
  $('btn-add').addEventListener('click', () => { const v = values(); if (v.length < 4) { v.push(`Player ${v.length + 1}`); renderInputs(v); } });
  $('setup-form').addEventListener('submit', e => { e.preventDefault(); const n = cleanNames(); store.set(KEY_NAMES, n); start(n); });
  $('btn-bot').addEventListener('click', () => {
    const name = (values()[0] || '').trim() || 'Player 1';
    store.set(KEY_NAMES, [name, values()[1] || 'Player 2'].map((x, i) => (x.trim() || `Player ${i + 1}`)));
    start([name, 'Bot'], 1);
  });
  $('btn-resume').addEventListener('click', () => {
    const s = store.get(KEY_SAVED);
    if (s && s.phase === 'play') { game = s; resetView(); show('game'); render(); }
  });
  $('btn-discard').addEventListener('click', () => { store.del(KEY_SAVED); $('resume-banner').hidden = true; });
  const dlg = (d, open) => { if (open) { if (d.showModal) d.showModal(); else d.hidden = false; } else if (d.close) d.close(); else d.hidden = true; };
  $('btn-rules').addEventListener('click', () => dlg($('rules-dialog'), true));
  $('btn-rules-start').addEventListener('click', () => dlg($('rules-dialog'), true));
  $('btn-close-rules').addEventListener('click', () => dlg($('rules-dialog'), false));
  $('btn-menu').addEventListener('click', () => dlg($('menu-dialog'), true));
  $('btn-close-menu').addEventListener('click', () => dlg($('menu-dialog'), false));
  function toSetup() { clearTimeout(botTimer); botTimer = null; game = null; renderInputs(savedNames()); checkResume(); show('start'); }
  $('btn-quit').addEventListener('click', () => {
    dlg($('menu-dialog'), false);
    if (net) { if (confirm('Leave this online room?')) net.leave(); return; }
    if (confirm('Leave this game and return to setup? It stays saved so you can resume.')) toSetup();
  });
  $('btn-again').addEventListener('click', () => {
    const bot = game.players.findIndex(p => p.bot);
    start(game.players.map(p => p.name), bot >= 0 ? bot : undefined);
  });
  $('btn-leave-end').addEventListener('click', () => { if (net) net.leave(); });
  $('btn-setup').addEventListener('click', toSetup);

  // --- Online (driven by online.js) ---
  window.UnoApp = {
    showScreen(name) { show(name); },
    enterOnline(v, send, leave) {
      if (!net) resetView();
      net = { send, leave, you: v.you, view: v.game };
      if (v.phase === 'over') { endScreen(); return; }
      show('game');
      render();
    },
    exitOnline() { net = null; game = null; resetView(); },
    leave() { if (net) net.leave(); },
    status(text) { note = { text, cls: 'bad' }; if (net) render(); }
  };

  renderInputs(savedNames());
  checkResume();
  show('start');
})();

// Desktop keyboard shortcuts. D draws, U calls Uno, C catches, P passes, 1-9 plays that card.
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const game = document.getElementById('screen-game');
  if (!game || game.hidden) return;
  const press = el => { if (el && !el.hidden && !el.disabled) { e.preventDefault(); el.click(); } };
  const nth = (sel, n) => press(document.querySelectorAll(sel)[n - 1]);
  const k = e.key.toLowerCase();
  if (e.target.tagName === 'BUTTON' && (k === ' ' || k === 'enter')) return;   // the focused button handles its own activation
  if (k === 'd') press(document.getElementById('draw-pile'));
  else if (k === 'u') press(document.getElementById('btn-uno'));
  else if (k === 'c') press(document.getElementById('btn-catch'));
  else if (k === 'p') press(document.getElementById('btn-pass'));
  else if (/^[1-9]$/.test(k)) nth('#hand .uc', +k);
});
