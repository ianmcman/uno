(function () {
  'use strict';
  const KEY_SESSION = 'uno_online_session', KEY_NAME = 'uno_online_name';
  const $ = id => document.getElementById(id);
  const App = window.UnoApp;

  let session = null, source = null, view = null, checking = false;

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* blocked */ } }
  };
  const show = (el, msg) => { el.textContent = msg || ''; el.hidden = !msg; };

  async function api(url, body) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session ? { 'x-token': session.token } : {}) },
        body: JSON.stringify(body || {})
      });
    } catch {
      throw new Error("You're offline. Hot-seat play still works.");
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  async function serverUp() {
    try { return (await fetch('/healthz')).ok; } catch { return false; }
  }

  function connect(code, watch) {
    if (source) source.close();
    source = new EventSource(`/api/rooms/${encodeURIComponent(code)}/events?watch=${encodeURIComponent(watch)}`);
    source.onopen = () => { $('reconnecting').hidden = true; };
    source.onmessage = e => {
      $('reconnecting').hidden = true;
      try { onView(JSON.parse(e.data)); } catch (err) { console.error('Bad event', err); }
    };
    source.onerror = () => { $('reconnecting').hidden = false; probe(code, watch); };
  }

  // EventSource retries on its own; this only notices a room that is gone.
  async function probe(code, watch) {
    if (checking) return;
    checking = true;
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/events?watch=${encodeURIComponent(watch)}`);
      if (res.status === 404 || res.status === 403) leave('That room has expired or no longer exists.');
      if (res.body) res.body.cancel();
    } catch { /* still offline */ } finally { checking = false; }
  }

  function onView(v) {
    view = v;
    if (v.phase === 'lobby') {
      App.exitOnline();
      App.showScreen('lobby');
      renderLobby(v);
    } else {
      App.enterOnline(v, send, () => leave());
    }
  }

  function renderLobby(v) {
    $('lobby-code').textContent = v.code;
    $('lobby-count').textContent = v.players.length;
    const list = $('lobby-list');
    list.innerHTML = '';
    v.players.forEach((p, i) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = p.name;
      li.appendChild(name);
      const tags = [i === 0 ? 'Host' : null, i === v.you ? 'You' : null].filter(Boolean);
      if (tags.length) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = tags.join(' · '); li.appendChild(t); }
      list.appendChild(li);
    });
    $('btn-start-online').hidden = !v.host;
    $('btn-start-online').disabled = v.players.length < 2;
    $('lobby-wait').hidden = v.host;
    show($('lobby-error'), '');
  }

  async function send(action) {
    if (!session) return;
    try {
      await api(`/api/rooms/${encodeURIComponent(session.code)}/act`, action);
    } catch (err) {
      App.status(err.message);
    }
  }

  function leave(message) {
    if (source) { source.close(); source = null; }
    session = null; view = null;
    store.del(KEY_SESSION);
    $('reconnecting').hidden = true;
    if (location.hash) history.replaceState(null, '', location.pathname);
    App.exitOnline();
    App.showScreen('start');
    show($('online-start-error'), message);
  }

  function enter(res) {
    session = { code: res.code, token: res.token, watch: res.watch };
    store.set(KEY_SESSION, session);
    history.replaceState(null, '', '#' + res.code);
    connect(res.code, res.watch);
  }

  async function openOnline(code) {
    show($('online-start-error'), '');
    if (!(await serverUp())) { show($('online-start-error'), "You're offline, or online play is unavailable. Hot-seat play still works."); return; }
    $('online-name').value = store.get(KEY_NAME) || '';
    const prompt = $('online-join-prompt');
    prompt.hidden = !code;
    if (code) { prompt.textContent = `Joining room ${code}. Enter your name to continue.`; $('online-code').value = code; }
    show($('online-error'), '');
    App.showScreen('online');
    $('online-name').focus();
  }

  function name() {
    const n = $('online-name').value.trim();
    if (!n) { show($('online-error'), 'Please enter your name.'); $('online-name').focus(); return null; }
    store.set(KEY_NAME, n);
    return n;
  }

  $('btn-play-online').addEventListener('click', () => openOnline());
  $('btn-online-back').addEventListener('click', () => { if (location.hash) history.replaceState(null, '', location.pathname); App.showScreen('start'); });

  $('btn-create-room').addEventListener('click', async () => {
    show($('online-error'), '');
    const n = name();
    if (!n) return;
    $('btn-create-room').disabled = true;
    try { enter(await api('/api/rooms', { name: n })); } catch (err) { show($('online-error'), err.message); } finally { $('btn-create-room').disabled = false; }
  });

  $('btn-join-room').addEventListener('click', async () => {
    show($('online-error'), '');
    const n = name();
    if (!n) return;
    const code = $('online-code').value.trim().toUpperCase();
    if (code.length !== 4) { show($('online-error'), 'Please enter a 4-letter room code.'); $('online-code').focus(); return; }
    $('btn-join-room').disabled = true;
    try {
      const res = await api(`/api/rooms/${encodeURIComponent(code)}/join`, { name: n });
      enter({ code, token: res.token, watch: res.watch });
    } catch (err) { show($('online-error'), err.message); } finally { $('btn-join-room').disabled = false; }
  });

  $('btn-start-online').addEventListener('click', async () => {
    $('btn-start-online').disabled = true;
    try { await api(`/api/rooms/${encodeURIComponent(session.code)}/start`); } catch (err) { show($('lobby-error'), err.message); $('btn-start-online').disabled = false; }
  });

  $('btn-copy-invite').addEventListener('click', async () => {
    const url = `${location.origin}/#${session.code}`;
    try { await navigator.clipboard.writeText(url); $('copy-status').textContent = 'Invite link copied.'; }
    catch { $('copy-status').textContent = url; }
  });

  $('btn-leave-lobby').addEventListener('click', () => leave());

  // Resume a room after a reload, or open an invite link.
  const saved = store.get(KEY_SESSION);
  const hashCode = (location.hash || '').slice(1).toUpperCase();
  if (saved && saved.code && saved.token && saved.watch && (!hashCode || hashCode === saved.code)) {
    session = saved;
    connect(saved.code, saved.watch);
  } else if (/^[A-Z2-9]{4}$/.test(hashCode)) {
    openOnline(hashCode);
  }
})();
