const crypto = require('node:crypto');
const game = require('../site/game.js');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ROOMS = 300;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanName(name) {
  if (typeof name !== 'string') throw httpError(400, 'Name must be a string');
  const trimmed = name.trim().slice(0, 20).trim();
  if (!trimmed) throw httpError(400, 'Name cannot be empty');
  return trimmed;
}

function createRoomStore(options = {}) {
  const rng = options.rng || (() => crypto.randomInt(0, 2 ** 32) / 2 ** 32);
  const now = options.now || (() => Date.now());
  const rooms = new Map();

  function generateCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
    } while (rooms.has(code));
    return code;
  }

  function getRoom(code) {
    const room = typeof code === 'string' ? rooms.get(code.toUpperCase()) : null;
    if (!room) throw httpError(404, 'Room not found');
    return room;
  }

  function notify(room) {
    for (const sub of room.subscribers) {
      try { sub(); } catch { /* a dead stream must not stop the rest */ }
    }
  }

  const newToken = () => crypto.randomBytes(16).toString('hex');

  function create(name) {
    const validName = cleanName(name);
    if (rooms.size >= MAX_ROOMS) throw httpError(503, 'Too many rooms right now. Try again later.');
    const code = generateCode();
    const token = newToken();
    rooms.set(code, { code, phase: 'lobby', players: [{ name: validName, token, watch: newToken() }], game: null, lastActivity: now(), subscribers: new Set() });
    return { code, token, watch: rooms.get(code).players[0].watch };
  }

  function join(code, name) {
    const room = getRoom(code);
    if (room.phase !== 'lobby') throw httpError(409, 'Cannot join game in progress');
    if (room.players.length >= 4) throw httpError(409, 'Room is full');
    const token = newToken();
    const watch = newToken();
    room.players.push({ name: cleanName(name), token, watch });
    room.lastActivity = now();
    notify(room);
    return { token, watch };
  }

  function playerIndex(room, token) {
    const i = room.players.findIndex(p => p.token === token);
    if (i === -1) throw httpError(403, 'Invalid token');
    return i;
  }

  function start(code, token) {
    const room = getRoom(code);
    if (playerIndex(room, token) !== 0) throw httpError(409, 'Only the host can start the game');
    if (room.phase !== 'lobby') throw httpError(409, 'Game already started');
    if (room.players.length < 2) throw httpError(409, 'Need at least 2 players to start');
    room.phase = 'playing';
    room.game = game.newGame(room.players.map(p => p.name), rng);
    room.lastActivity = now();
    notify(room);
  }

  // play, draw and pass belong to the player whose turn it is; Uno calls and catches can come from anyone at any time.
  function act(code, token, action) {
    const room = getRoom(code);
    const idx = playerIndex(room, token);
    if (room.phase !== 'playing') throw httpError(409, 'Game is not in playing phase');
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') throw httpError(400, 'Malformed action');
    const g = room.game;
    const turnOnly = ['play', 'draw', 'pass'].includes(action.type);
    if (turnOnly && idx !== g.current) throw httpError(409, 'Not your turn');
    try {
      switch (action.type) {
        case 'play':
          if (!Number.isInteger(action.index)) throw new Error('Invalid card');
          game.play(g, action.index, action.color, rng);
          break;
        case 'draw': game.draw(g, rng); break;
        case 'pass': game.pass(g); break;
        case 'uno': game.callUno(g, idx); break;
        case 'catch': game.catchUno(g, idx, rng); break;
        default: throw new Error('Unknown action type');
      }
    } catch (err) {
      throw httpError(400, err.message);
    }
    if (game.isOver(g)) room.phase = 'over';
    room.lastActivity = now();
    notify(room);
  }

  // The event stream goes in a URL, so it takes a read-only `watch` token; only `token` can act.
  function view(code, watch) {
    const room = getRoom(code);
    const idx = room.players.findIndex(p => p.watch === watch);
    if (idx === -1) throw httpError(403, 'Invalid token');
    return {
      code: room.code,
      phase: room.phase,
      players: room.players.map(p => ({ name: p.name })),
      you: idx,
      host: idx === 0,
      game: room.game ? game.viewFor(room.game, idx) : null
    };
  }

  function subscribe(code, fn) {
    const room = getRoom(code);
    room.subscribers.add(fn);
    return () => { room.subscribers.delete(fn); };
  }

  function sweep() {
    const t = now();
    for (const [code, room] of rooms) {
      const idle = t - room.lastActivity;
      if (idle > 2 * 60 * 60 * 1000 || (room.phase === 'lobby' && idle > 30 * 60 * 1000)) {
        rooms.delete(code);
      }
    }
  }

  return { create, join, start, act, view, subscribe, sweep };
}

module.exports = { createRoomStore };
