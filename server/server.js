const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff'
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...HEADERS });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 4096) tooLarge = true; else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Payload Too Large'), { status: 413 }));
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// Behind a reverse proxy the socket peer is the proxy; trust X-Real-IP only from configured proxy addresses.
function makeClientIp(trusted) {
  const set = new Set(trusted);
  return req => {
    const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const fwd = req.headers['x-real-ip'];
    const raw = set.has(peer) && typeof fwd === 'string' && net.isIP(fwd.trim()) ? fwd.trim() : peer;
    return limitKey(raw);
  };
}

// An IPv6 client usually owns a whole /64, so key on that prefix; IPv4 stays as is.
function limitKey(ip) {
  if (net.isIP(ip) !== 6) return ip;
  const parts = ip.split('::');
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const full = parts.length > 1 ? [...head, ...new Array(8 - head.length - tail.length).fill('0'), ...tail] : head;
  return full.slice(0, 4).map(g => parseInt(g || '0', 16).toString(16)).join(':') + '::/64';
}

// ok(key) only reads; add(key) records a hit. Callers record only what they mean to count.
function createLimiter(max, windowMs) {
  const hits = new Map();
  const recent = key => {
    const cut = Date.now() - windowMs;
    return (hits.get(key) || []).filter(x => x > cut);
  };
  return {
    ok: key => recent(key).length < max,
    add: key => {
      const list = recent(key);
      list.push(Date.now());
      hits.delete(key);                                     // re-insert so the oldest keys come first
      hits.set(key, list);
      if (hits.size > 5000) for (const [k, v] of hits) if (v[v.length - 1] <= Date.now() - windowMs) hits.delete(k);
      while (hits.size > 20000) hits.delete(hits.keys().next().value);      // hard cap on memory
    }
  };
}

function createServer({ store, staticDir, trustedProxies = [], createLimit = 10, joinLimit = 40 }) {
  const root = path.resolve(staticDir);
  const clientIp = makeClientIp(trustedProxies);
  const allowCreate = createLimiter(createLimit, 60 * 60e3);
  const allowJoin = createLimiter(joinLimit, 15 * 60e3);
  const allowCreateAll = createLimiter(createLimit * 20, 60 * 60e3);     // one cap for everyone together; it takes 20 addresses to reach it
  const allowGuess = createLimiter(joinLimit, 15 * 60e3);               // failed token or room lookups on the other routes

  async function api(req, res, pathname, url) {
    const method = req.method;
    try {
      if (method === 'POST' && pathname === '/api/rooms') {
        const ip = clientIp(req);
        if (!allowCreate.ok(ip) || !allowCreateAll.ok('all')) return sendJson(res, 429, { error: 'Too many rooms right now. Try again later.' });
        allowCreate.add(ip);
        allowCreateAll.add('all');
        const body = await readJsonBody(req);
        return sendJson(res, 201, store.create(body.name));
      }
      const m = pathname.match(/^\/api\/rooms\/([^/]+)\/(join|start|act|events)$/);
      if (!m) return sendJson(res, 404, { error: 'Not Found' });
      const code = decodeURIComponent(m[1]);
      if (m[2] !== 'join') {
        // start, act and events answer 403 whether the room is missing or the token is wrong. Failures count against the
        // client; a request with a valid token is never refused, so one bad address cannot lock out players behind it.
        try { return await tokenRoute(req, res, m[2], code, url); } catch (err) {
          if (err.status === 404 || err.status === 403) {
            const ip = clientIp(req);
            if (!allowGuess.ok(ip)) return sendJson(res, 429, { error: 'Too many failed requests. Try again in a few minutes.' });
            allowGuess.add(ip);
            return sendJson(res, 403, { error: 'Invalid token' });
          }
          throw err;
        }
      }
      if (method === 'POST' && m[2] === 'join') {
        const ip = clientIp(req);
        if (!allowJoin.ok(ip)) return sendJson(res, 429, { error: 'Too many join attempts. Try again in a few minutes.' });
        allowJoin.add(ip);
        const body = await readJsonBody(req);
        return sendJson(res, 200, store.join(code, body.name));
      }
      return sendJson(res, 404, { error: 'Not Found' });
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.status ? err.message : 'Internal error' });
    }
  }

  async function tokenRoute(req, res, action, code, url) {
    const method = req.method;
    const tokenOf = () => req.headers['x-token'];
    if (method === 'POST' && action === 'start') {
      await readJsonBody(req);
      store.start(code, tokenOf());
      return sendJson(res, 200, {});
    }
    if (method === 'POST' && action === 'act') {
      const body = await readJsonBody(req);
      store.act(code, tokenOf(), body);
      return sendJson(res, 200, {});
    }
    if (method === 'GET' && action === 'events') return events(req, res, code, url.searchParams.get('watch'));
    return sendJson(res, 404, { error: 'Not Found' });
  }

  function events(req, res, code, token) {
    if (!token) return sendJson(res, 403, { error: 'Token is required' });
    const initial = store.view(code, token);        // throws for a missing room or wrong token; api() answers 403 for both
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...HEADERS });
    res.write(`data: ${JSON.stringify(initial)}\n\n`);
    let closed = false;
    const unsubscribe = store.subscribe(code, () => {
      try { res.write(`data: ${JSON.stringify(store.view(code, token))}\n\n`); } catch { cleanup(); res.end(); }
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    ping.unref();
    function cleanup() {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      unsubscribe();
    }
    req.on('close', cleanup);
    req.on('error', cleanup);
  }

  return http.createServer((req, res) => {
    let url, pathname;
    try { url = new URL(req.url, 'http://x'); pathname = decodeURIComponent(url.pathname); } catch { pathname = null; }
    if (pathname === null || pathname.includes('\0')) {
      res.writeHead(400, HEADERS);
      return res.end('Bad Request');
    }
    if (pathname.startsWith('/api/')) return api(req, res, pathname, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', ...HEADERS });
      return res.end();
    }
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...HEADERS });
      return res.end('ok');
    }
    const file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(404, HEADERS);
      return res.end('Not Found');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, HEADERS);
        return res.end('Not Found');
      }
      const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...HEADERS };
      if (path.basename(file) === 'sw.js') headers['Cache-Control'] = 'no-cache';
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

module.exports = { createServer, limitKey };

if (require.main === module) {
  const { createRoomStore } = require('./rooms.js');
  const store = createRoomStore();
  setInterval(() => store.sweep(), 10 * 60 * 1000).unref();
  const port = Number(process.env.PORT) || 8080;
  const trustedProxies = (process.env.TRUSTED_PROXY || '').split(',').map(x => x.trim()).filter(Boolean);
  createServer({ store, staticDir: path.join(__dirname, '..', 'site'), trustedProxies }).listen(port, '0.0.0.0', () => console.log(`Uno listening on ${port}`));
}
