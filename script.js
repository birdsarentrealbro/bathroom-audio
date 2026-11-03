/* ============================================================
   Bathroom Party Video Maker
   - Joins your audio files end-to-end, in order
   - Makes it sound like the party is outside the bathroom
     you're sitting in: muffled music through the wall, people
     talking, doors opening & closing (music swells when a
     door opens), plus a tiled-bathroom reverb on everything
   - Records a video of your picture + the processed audio
   - 100% client-side. Nothing is uploaded anywhere.
   ============================================================ */

'use strict';

/* ===================== Config: party sounds =====================
   These are fetched when you make the video. If you ever want to
   host the sounds yourself (same folder as this file), just change
   the paths, e.g. talking: 'sounds/talking.mp3' */
const PARTY_SOUNDS = {
  talking:   'https://file.garden/asDglyyf7wikLDL0/talking',
  doorOpen:  'https://file.garden/asDglyyf7wikLDL0/dragon-studio-opening-door-450444.mp3',
  doorClose: 'https://file.garden/asDglyyf7wikLDL0/dragon-studio-close-door-382723.mp3'
};

const $ = (id) => document.getElementById(id);

const els = {
  audioInput: $('audio-input'),  browseAudio: $('browse-audio'),  dropAudio: $('drop-audio'),
  folderInput: $('folder-input'), browseFolder: $('browse-folder'),
  audioList: $('audio-list'),     audioClear: $('audio-clear'),
  imageInput: $('image-input'),   browseImage: $('browse-image'), dropImage: $('drop-image'),
  imagePreview: $('image-preview'), imageThumb: $('image-thumb'),
  optTalking: $('opt-talking'),  optDoors: $('opt-doors'),
  optMuffle: $('opt-muffle'),    muffleVal: $('muffle-val'),
  optVolume: $('opt-volume'),    volumeVal: $('volume-val'),
  makeBtn: $('make-btn'),        status: $('status'),
  fill: $('progress-fill'),      pct: $('progress-pct'),
  label: $('status-label'),
  result: $('step-result'),      video: $('result-video'),
  info: $('video-info'),         download: $('download-btn'),
  remake: $('remake-btn'),       toasts: $('toasts')
};

const spEls = {
  url: $('sp-url'),              importBtn: $('sp-import'),
  progress: $('sp-progress'),    progressFill: $('sp-progress-fill'),
  progressText: $('sp-progress-text'),
  error: $('sp-error'),          connect: $('sp-connect'),
  cid: $('sp-cid'),              connectBtn: $('sp-connect-btn'),
  redirect: $('sp-redirect-uri'),
  panel: $('sp-panel'),          cover: $('sp-cover'),
  name: $('sp-name'),            meta: $('sp-meta'),          forget: $('sp-forget'),
  tracks: $('sp-tracks'),        nomatch: $('sp-nomatch'),
  apply: $('sp-apply'),          previews: $('sp-use-previews'),
  applyHint: $('sp-apply-hint'), pick: $('sp-file-pick'),
  helper: $('sp-helper'),        helperCmd: $('sp-helper-cmd'),
  helperCopy: $('sp-helper-copy'), loadJson: $('sp-load-json'),
  jsonInput: $('sp-json-input')
};

let actx = null;          // shared AudioContext
let audioItems = [];      // [{file, name}]
let imageFile = null;
let busy = false;
let leaveGuard = null;

function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

/* Some browsers keep the context suspended until a real user gesture.
   Recording would silently hang if the audio clock never started, so
   we wait for it properly and fail with a clear message if we can't. */
async function ensureRunning() {
  const c = audioCtx();
  if (c.state !== 'running') {
    try { await c.resume(); } catch (e) {}
    for (let i = 0; i < 25 && c.state !== 'running'; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  if (c.state !== 'running') throw new Error('Audio is blocked by the browser. Click anywhere on the page, then press “Make the video” again.');
}

/* ======================= UI helpers ======================= */

function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'err' ? ' err' : '');
  t.textContent = msg;
  els.toasts.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, 4800);
}

function fmtSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1e3)) + ' KB';
}

function fmtTime(s) {
  s = Math.round(s);
  const m = Math.floor(s / 60), r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}

function isAudioFile(f) {
  return f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm|mp4)$/i.test(f.name);
}

function isImageFile(f) {
  return f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name);
}

function setProgress(pct, label, opts) {
  els.status.classList.remove('hidden');
  const ind = !!(opts && opts.indeterminate);
  els.fill.classList.toggle('indeterminate', ind);
  if (ind) els.fill.style.width = '';
  else els.fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  els.pct.textContent = ind ? '' : Math.round(pct) + '%';
  els.fill.parentElement.setAttribute('aria-valuenow', ind ? '' : Math.round(pct));
  if (label !== undefined) els.label.textContent = label;
}

function updateMakeBtn() {
  els.makeBtn.disabled = busy || audioItems.length === 0 || !imageFile;
}

/* ======================= file selection ======================= */

function addAudioFiles(list) {
  const ok = [], skipped = [];
  for (const f of list) (isAudioFile(f) ? ok : skipped).push(f);
  if (skipped.length) toast('Skipped ' + skipped.length + ' non-audio file' + (skipped.length > 1 ? 's' : '') + '.', 'err');
  if (!ok.length) return;
  if (sp.playlist) {
    ok.forEach((f) => { f.__t = null; f.__xtra = false; });
    sp.pool = sp.pool.concat(ok);
    runMatcher();
    renderSpPanel();
    const matched = sp.tracks.filter((t) => t.file && !t.skipped).length;
    toast('Matched ' + matched + ' of ' + sp.tracks.length + ' playlist tracks so far.');
  } else {
    audioItems = audioItems.concat(ok.map((f) => ({ file: f, name: f.name })));
    renderAudioList();
  }
}

function renderAudioList() {
  els.audioList.innerHTML = '';
  audioItems.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'file-row';

    const num = document.createElement('span');
    num.className = 'file-num';
    num.textContent = (i + 1) + '.';

    const nm = document.createElement('span');
    nm.className = 'file-name';
    nm.textContent = it.name;
    nm.title = it.name;

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = fmtSize(it.file.size);

    const btns = document.createElement('span');
    btns.className = 'row-btns';
    const mk = (txt, cls, title, fn, dis) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = txt;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.disabled = !!dis;
      b.addEventListener('click', fn);
      btns.appendChild(b);
    };
    mk('↑', 'icon', 'Move up', () => move(i, -1), i === 0);
    mk('↓', 'icon', 'Move down', () => move(i, 1), i === audioItems.length - 1);
    mk('✕', 'icon remove', 'Remove', () => { audioItems.splice(i, 1); renderAudioList(); });

    li.append(num, nm, meta, btns);
    els.audioList.appendChild(li);
  });
  els.audioClear.classList.toggle('hidden', audioItems.length === 0);
  updateMakeBtn();
}

function move(i, d) {
  const j = i + d;
  const tmp = audioItems[i]; audioItems[i] = audioItems[j]; audioItems[j] = tmp;
  renderAudioList();
}

function setImage(f) {
  if (!f) return;
  if (!isImageFile(f)) {
    toast('That file is not an image.', 'err');
    return;
  }
  imageFile = f;
  if (els.imageThumb.src && els.imageThumb.src.startsWith('blob:')) URL.revokeObjectURL(els.imageThumb.src);
  els.imageThumb.src = URL.createObjectURL(f);
  els.imageThumb.alt = 'Your picture: ' + f.name;
  els.imagePreview.classList.remove('hidden');
  els.dropImage.classList.add('slim');
  updateMakeBtn();
}

function fetchTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 12000);
  return fetch(url, Object.assign({}, opts, { signal: ctl.signal }))
    .finally(() => clearTimeout(t));
}

/* ======================= Spotify import =======================
   Spotify doesn't allow downloading full songs, so a playlist import
   gives us the track list & order (plus 30-second preview MP3s, which
   ARE publicly fetchable). Two paths:
   - public: read Spotify's own embed page through a CORS proxy chain
   - app:    user's own Spotify app via Authorization Code + PKCE
     (works for private playlists; no client secret needed) */

const sp = {
  playlist: null,   // {id, name, cover, url, via}
  tracks: [],       // {title, subtitle, durMs, previewUrl, key, file, manual, skipped}
  pool: [],         // files offered to the matcher; __t = matched track idx, __xtra = append anyway
  cache: new Map()  // playlist id -> parsed data
};

const SP_PROXIES = [
  (u) => 'https://cors.eu.org/' + u,
  (u) => 'https://api.cors.lol/?url=' + encodeURIComponent(u),
  (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => u
];

function parseSpotifyInput(raw) {
  raw = (raw || '').trim();
  if (!raw) return { ok: false, why: 'empty' };
  let m = raw.match(/spotify:playlist:([A-Za-z0-9]+)/);
  if (m) return { ok: true, id: m[1] };
  m = raw.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:user\/[^/]+\/)?playlist\/([A-Za-z0-9]+)/);
  if (m) return { ok: true, id: m[1] };
  const other = raw.match(/spotify:(track|album|artist|episode|show):/) ||
                raw.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|artist|episode|show)\//);
  if (other) return { ok: false, why: 'type:' + other[1] };
  if (/spotify/i.test(raw)) return { ok: false, why: 'unrecognized' };
  return { ok: false, why: 'notspotify' };
}

function spToastWhy(why) {
  if (why === 'empty') toast('Paste a playlist link first.', 'err');
  else if (why.indexOf('type:') === 0) toast('That\u2019s a Spotify ' + why.slice(5) + ' link \u2014 I need a playlist link.', 'err');
  else if (why === 'unrecognized') toast('That Spotify link doesn\u2019t look like a playlist.', 'err');
  else toast('That doesn\u2019t look like a Spotify link.', 'err');
}

function spShowProgress(text) {
  spEls.progress.classList.remove('hidden');
  spEls.progressFill.style.width = '0%';
  spEls.progressText.textContent = text || 'Loading playlist…';
}
function spSetProgress(p, text) {
  spEls.progressFill.style.width = Math.max(0, Math.min(100, p * 100)) + '%';
  if (text) spEls.progressText.textContent = text;
}
function spHideProgress() { spEls.progress.classList.add('hidden'); }

/* ---- PKCE (user's own app; no secret, works on static hosting) ---- */

function b64url(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function spSaveToken(j) {
  try {
    sessionStorage.setItem('bpvm_tok', JSON.stringify({
      t: j.access_token,
      exp: Date.now() + (j.expires_in - 30) * 1000,
      rt: j.refresh_token || null
    }));
    if (j.refresh_token) localStorage.setItem('bpvm_rt', j.refresh_token);
  } catch (e) {}
}

async function spFreshToken() {
  let tok = null;
  try { tok = JSON.parse(sessionStorage.getItem('bpvm_tok') || 'null'); } catch (e) {}
  if (tok && tok.exp > Date.now()) return tok.t;
  const rt = (tok && tok.rt) || localStorage.getItem('bpvm_rt');
  const cid = localStorage.getItem('bpvm_cid');
  if (!rt || !cid) return null;
  try {
    const r = await fetchTimeout('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: rt, client_id: cid
      })
    }, 12000);
    const j = await r.json();
    if (j.access_token) { spSaveToken(j); return j.access_token; }
  } catch (e) {}
  localStorage.removeItem('bpvm_rt');
  sessionStorage.removeItem('bpvm_tok');
  return null;
}

async function spLogin() {
  const cid = spEls.cid.value.trim();
  if (!cid) { toast('Paste your Spotify Client ID first.', 'err'); return; }
  localStorage.setItem('bpvm_cid', cid);
  if (!/^https?:$/.test(location.protocol)) {
    toast('Connecting needs an http(s) page — on GitHub Pages it works fine.', 'err');
    return;
  }
  if (!window.crypto || !crypto.subtle) { toast('This browser can\u2019t do the secure login here.', 'err'); return; }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  try {
    localStorage.setItem('bpvm_pkce', JSON.stringify({ verifier, state }));
  } catch (e) {}
  localStorage.setItem('bpvm_pending', spEls.url.value.trim());
  const params = new URLSearchParams({
    client_id: cid,
    response_type: 'code',
    redirect_uri: location.origin + location.pathname,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: state,
    scope: 'playlist-read-private playlist-read-collaborative'
  });
  location.assign('https://accounts.spotify.com/authorize?' + params.toString());
}

async function spHandleCallback() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code'), state = q.get('state'), err = q.get('error');
  if (!code && !err) return;
  let pk = null;
  try { pk = JSON.parse(localStorage.getItem('bpvm_pkce') || 'null'); } catch (e) {}
  history.replaceState(null, '', location.pathname);
  if (err || !pk || state !== pk.state) {
    if (err) toast('Spotify connection was cancelled.', 'err');
    localStorage.removeItem('bpvm_pkce');
    return;
  }
  try {
    const r = await fetchTimeout('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: location.origin + location.pathname,
        client_id: localStorage.getItem('bpvm_cid') || '',
        code_verifier: pk.verifier
      })
    }, 15000);
    const j = await r.json();
    if (j.access_token) {
      spSaveToken(j);
      toast('Spotify connected ✓');
    } else {
      toast('Spotify connection failed: ' + (j.error_description || j.error || 'unknown error'), 'err');
    }
  } catch (e) {
    toast('Spotify connection failed — check your Client ID and redirect URI.', 'err');
  }
  localStorage.removeItem('bpvm_pkce');
  const pending = localStorage.getItem('bpvm_pending');
  localStorage.removeItem('bpvm_pending');
  if (pending) {
    spEls.url.value = pending;
    importPlaylist();
  }
}

/* ---- data fetchers ---- */

async function fetchViaApi(id) {
  const tok = await spFreshToken();
  if (!tok) return null;
  const get = async (url) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = attempt ? await spFreshToken() : tok;
      if (!t) return null;
      const r = await fetchTimeout(url, { headers: { Authorization: 'Bearer ' + t } }, 12000);
      if (r.status === 401 && attempt === 0) continue;
      if (!r.ok) return null;
      return await r.json();
    }
    return null;
  };
  const pl = await get('https://api.spotify.com/v1/playlists/' + id);
  if (!pl) return null;
  const tracks = [];
  let url = 'https://api.spotify.com/v1/playlists/' + id + '/tracks?limit=100';
  let guard = 0;
  while (url && guard++ < 20) {
    const page = await get(url);
    if (!page) break;
    (page.items || []).forEach((it) => {
      const t = it && it.track;
      if (t && t.type === 'track') {
        tracks.push({
          title: t.name || '',
          subtitle: (t.artists || []).map((a) => a.name).filter(Boolean).join(', '),
          durMs: t.duration_ms || 0,
          previewUrl: t.preview_url || null,
          uri: t.uri || null
        });
      }
    });
    url = page.next;
  }
  if (!tracks.length) return null;
  return {
    name: pl.name || 'Spotify playlist',
    cover: (pl.images && pl.images[0] && pl.images[0].url) || null,
    tracks: tracks
  };
}

function parseEmbedHtml(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    const ent = d && d.props && d.props.pageProps && d.props.pageProps.state &&
                d.props.pageProps.state.data && d.props.pageProps.state.data.entity;
    if (!ent || !Array.isArray(ent.trackList) || !ent.trackList.length) return null;
    const attrs = {};
    (ent.attributes || []).forEach((a) => { if (a && a.key) attrs[a.key] = a.value; });
    return {
      name: ent.name || ent.title || 'Spotify playlist',
      cover: attrs.image_url || null,
      tracks: ent.trackList.map((t) => ({
        title: t.title || '',
        subtitle: t.subtitle || '',
        durMs: t.duration || 0,
        previewUrl: (t.audioPreview && t.audioPreview.url) || null,
        uri: t.uri || null
      }))
    };
  } catch (e) { return null; }
}

async function fetchViaEmbed(id) {
  const target = 'https://open.spotify.com/embed/playlist/' + id;
  for (const wrap of SP_PROXIES) {
    try {
      const r = await fetchTimeout(wrap(target), {}, 14000);
      if (!r.ok) continue;
      const html = await r.text();
      const data = parseEmbedHtml(html);
      if (data) return data;
    } catch (e) { /* try next proxy */ }
  }
  return null;
}

async function fetchOembed(id) {
  try {
    const u = 'https://open.spotify.com/oembed?url=' +
      encodeURIComponent('https://open.spotify.com/playlist/' + id);
    const r = await fetchTimeout(u, {}, 8000);
    if (!r.ok) return null;
    const j = await r.json();
    return { name: j.title || null, cover: j.thumbnail_url || null };
  } catch (e) { return null; }
}

async function importPlaylist() {
  if (busy) { toast('Wait for the current job to finish.', 'err'); return; }
  const parsed = parseSpotifyInput(spEls.url.value);
  if (!parsed.ok) { spToastWhy(parsed.why); return; }

  if (sp.playlist && sp.playlist.id === parsed.id && sp.tracks.length) {
    spEls.panel.classList.remove('hidden');
    spEls.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  spEls.error.classList.add('hidden');
  spEls.connect.classList.add('hidden');
  spShowProgress('Loading playlist…');

  let data = null, via = '';
  if (sp.cache.has(parsed.id)) {
    data = sp.cache.get(parsed.id); via = 'cache';
  } else {
    data = await fetchViaApi(parsed.id);
    if (data) via = 'app';
    if (!data) {
      data = await fetchViaEmbed(parsed.id);
      if (data) via = 'public';
    }
    if (data) sp.cache.set(parsed.id, data);
  }

  if (!data) {
    spHideProgress();
    spEls.error.classList.remove('hidden');
    spEls.connect.classList.remove('hidden');
    if (spEls.helper) spEls.helper.open = true;   /* playlist.json path lives there */
    return;
  }

  if (!data.cover || !data.name) {
    const oe = await fetchOembed(parsed.id);
    if (oe) { data.name = data.name || oe.name; data.cover = data.cover || oe.cover; }
  }

  sp.playlist = {
    id: parsed.id,
    name: data.name || 'Spotify playlist',
    cover: data.cover || '',
    url: 'https://open.spotify.com/playlist/' + parsed.id,
    via: via
  };
  sp.tracks = data.tracks.map((t) => ({
    title: t.title,
    subtitle: t.subtitle,
    durMs: t.durMs,
    previewUrl: t.previewUrl,
    uri: t.uri,
    key: normKey((t.subtitle ? t.subtitle + ' ' : '') + t.title),
    file: null,
    manual: false,
    skipped: false
  }));
  sp.pool = [];
  runMatcher();

  spHideProgress();
  spEls.error.classList.add('hidden');
  spEls.connect.classList.add('hidden');
  renderSpPanel();
  const totMs = sp.tracks.reduce((s, t) => s + (t.durMs || 0), 0);
  toast('Imported \u201c' + sp.playlist.name + '\u201d \u2014 ' + sp.tracks.length +
    ' tracks' + (totMs ? ' \u00b7 ' + fmtTime(totMs / 1000) : '') + '.');
  spEls.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---- filename <-> track matching ---- */

const NORM_NOISE = /remaster|deluxe|expanded|reissue|bonus|anniversary|edition|explicit|official|video|audio|\bedit\b|\bmix\b|\bversion\b|\bsingle\b|\bmono\b|\bstereo\b|\blive\b|\bradio\b|\binstrumental\b|\bacoustic\b|\bcover\b|\blyric[s]?\b|\bvisualizer\b/i;

function normKey(s) {
  if (!s) return '';
  let x = String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  x = x.replace(/[([{]([^)\]}]*)[)\]}]/g, (m, inner) => NORM_NOISE.test(inner) ? ' ' : ' ' + inner + ' ');
  x = x.replace(/\bfeat\.?(uring)?\b[\s\S]*$/, ' ').replace(/\bft\.?\b[\s\S]*$/, ' ');
  x = x.replace(/\b(the|a|an|and)\b/g, ' ');
  x = x.replace(/\b(mp3|mp4|wav|flac|m4a|aac|ogg|oga|opus|webm|wma|aiff?|alac)\b/g, ' ');
  x = x.replace(/^v\d+\s*[-.]?\s*/, '');
  x = x.replace(/^\s*0*\d{1,3}\s*[-\u2013._]+\s*/, '');
  x = x.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return x;
}

function matchScore(trackKey, fileKey) {
  if (!trackKey || !fileKey) return 0;
  if (trackKey === fileKey) return 1;
  const shorter = trackKey.length < fileKey.length ? trackKey : fileKey;
  const longer = shorter === trackKey ? fileKey : trackKey;
  /* whole-word containment (e.g. "loser" inside "tame impala loser") */
  if (shorter.length >= 4) {
    const re = new RegExp('(?:^| )' + shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?: |$)');
    if (re.test(longer)) return 0.85;
  }
  const at = new Set(trackKey.split(' ')), af = new Set(fileKey.split(' '));
  let inter = 0;
  at.forEach((w) => { if (af.has(w)) inter++; });
  const union = at.size + af.size - inter;
  return union ? inter / union : 0;
}

function fileKeyOf(f) {
  if (!f.__key) {
    let base = f.name.replace(/\.[a-z0-9]{1,5}$/i, '');          /* last extension  */
    base = base.replace(/\.(mp3|mp4|wav|flac|m4a|aac|ogg|oga|opus|webm|wma|aiff?)$/i, ''); /* double ext */
    f.__key = normKey(base);
  }
  return f.__key;
}

function runMatcher() {
  if (!sp.playlist) return;
  sp.pool.forEach((f) => {
    if (f.__t != null && !(sp.tracks[f.__t] && sp.tracks[f.__t].manual)) f.__t = null;
  });
  sp.tracks.forEach((t) => { if (!t.manual) t.file = null; });
  const pairs = [];
  sp.tracks.forEach((t, ti) => {
    if (t.file || t.skipped) return;
    sp.pool.forEach((f, fi) => {
      if (f.__t != null) return;
      const s = matchScore(t.key, fileKeyOf(f));
      if (s >= 0.42) pairs.push([s, ti, fi]);
    });
  });
  pairs.sort((a, b) => b[0] - a[0]);
  pairs.forEach((p) => {
    const t = sp.tracks[p[1]], f = sp.pool[p[2]];
    if (t.file || f.__t != null) return;
    t.file = f;
    f.__t = p[1];
  });
}

/* ---- playlist panel rendering ---- */

let prevAudio = null, prevBtn = null;

function stopPreview() {
  if (prevAudio) { try { prevAudio.pause(); } catch (e) {} prevAudio = null; }
  if (prevBtn) { prevBtn.textContent = '\u25b6'; prevBtn = null; }
}

function togglePreview(t, btn) {
  if (prevBtn === btn) { stopPreview(); return; }
  stopPreview();
  prevAudio = new Audio();
  prevAudio.preload = 'none';
  prevAudio.src = t.previewUrl;
  prevAudio.play().catch(() => {
    toast('Couldn\u2019t play that preview.', 'err');
    stopPreview();
  });
  prevBtn = btn;
  btn.textContent = '\u25a0';
  prevAudio.onended = stopPreview;
  prevAudio.onerror = stopPreview;
}

function renderSpPanel() {
  if (!sp.playlist) { spEls.panel.classList.add('hidden'); return; }
  spEls.panel.classList.remove('hidden');
  spEls.name.textContent = sp.playlist.name;
  if (sp.playlist.cover) {
    spEls.cover.src = sp.playlist.cover;
    spEls.cover.classList.remove('hidden');
  } else {
    spEls.cover.classList.add('hidden');
  }
  const totMs = sp.tracks.reduce((s, t) => s + (t.durMs || 0), 0);
  spEls.meta.textContent = sp.tracks.length + ' tracks' +
    (totMs ? ' \u00b7 ' + fmtTime(totMs / 1000) : '') +
    ' \u00b7 ' + (sp.playlist.via === 'app' ? 'via your Spotify app' :
      sp.playlist.via === 'helper' ? 'track list from playlist.json' : 'public import');

  spEls.tracks.innerHTML = '';
  sp.tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'sp-track' + (t.skipped ? ' skipped' : (t.file ? ' matched' : ''));

    const num = document.createElement('span');
    num.className = 'sp-num';
    num.textContent = (i + 1) + '.';
    li.appendChild(num);

    if (t.previewUrl) {
      const pv = document.createElement('button');
      pv.type = 'button';
      pv.className = 'icon sp-prev';
      pv.title = 'Play 30-second preview';
      pv.setAttribute('aria-label', 'Preview ' + t.title);
      pv.textContent = '\u25b6';
      pv.addEventListener('click', () => togglePreview(t, pv));
      li.appendChild(pv);
    } else {
      const sp2 = document.createElement('span');
      sp2.style.flex = 'none'; sp2.style.width = '28px';
      li.appendChild(sp2);
    }

    const info = document.createElement('div');
    info.className = 'sp-info';
    const nm = document.createElement('p');
    nm.className = 'sp-tname';
    nm.style.margin = '0';
    nm.textContent = t.title || '(untitled)';
    const ar = document.createElement('p');
    ar.className = 'sp-tartist';
    ar.style.margin = '0';
    ar.textContent = t.subtitle || '';
    info.append(nm, ar);
    li.appendChild(info);

    const dur = document.createElement('span');
    dur.className = 'sp-dur';
    dur.textContent = t.durMs ? fmtTime(t.durMs / 1000) : '';
    li.appendChild(dur);

    const fileBox = document.createElement('div');
    fileBox.className = 'sp-file';
    if (t.file) {
      const fn = document.createElement('span');
      fn.className = 'fname';
      fn.textContent = t.file.name;
      fn.title = t.file.name;
      fileBox.appendChild(fn);
      const un = document.createElement('button');
      un.type = 'button';
      un.className = 'sp-mini';
      un.title = 'Unlink this file';
      un.textContent = '\u2715';
      un.addEventListener('click', () => {
        if (t.file) t.file.__t = null;
        t.file = null;
        t.manual = false;
        runMatcher();
        renderSpPanel();
      });
      fileBox.appendChild(un);
    } else {
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'sp-mini';
      pick.textContent = '+ file';
      pick.title = 'Pick the audio file for this track';
      pick.addEventListener('click', () => {
        pickIdx = i;
        spEls.pick.click();
      });
      fileBox.appendChild(pick);
    }
    li.appendChild(fileBox);

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'sp-mini';
    skip.title = t.skipped ? 'Un-skip this track' : 'Skip this track';
    skip.textContent = t.skipped ? '\u21ba back' : 'skip';
    skip.addEventListener('click', () => {
      t.skipped = !t.skipped;
      renderSpPanel();
    });
    li.appendChild(skip);

    spEls.tracks.appendChild(li);
  });

  const unmatched = sp.pool.filter((f) => f.__t == null);
  if (unmatched.length) {
    spEls.nomatch.classList.remove('hidden');
    spEls.nomatch.innerHTML = '';
    const title = document.createElement('p');
    title.className = 'nm-title';
    title.textContent = unmatched.length + ' file' + (unmatched.length > 1 ? 's' : '') +
      ' didn\u2019t match any track:';
    spEls.nomatch.appendChild(title);
    unmatched.forEach((f) => {
      const chip = document.createElement('div');
      chip.className = 'nm-chip' + (f.__xtra ? ' added' : '');
      const nm = document.createElement('span');
      nm.className = 'nm-name';
      nm.textContent = f.name;
      nm.title = f.name;
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'sp-mini';
      add.textContent = f.__xtra ? 'added' : '+ add anyway';
      add.title = 'Append this file after the playlist tracks';
      add.addEventListener('click', () => { f.__xtra = !f.__xtra; renderSpPanel(); });
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'sp-mini';
      rm.textContent = '\u2715';
      rm.title = 'Remove this file';
      rm.addEventListener('click', () => {
        sp.pool.splice(sp.pool.indexOf(f), 1);
        renderSpPanel();
      });
      chip.append(nm, add, rm);
      spEls.nomatch.appendChild(chip);
    });
  } else {
    spEls.nomatch.classList.add('hidden');
  }

  const matched = sp.tracks.filter((t) => t.file && !t.skipped).length;
  const extras = sp.pool.filter((f) => f.__xtra && f.__t == null).length;
  const withPrev = sp.tracks.filter((t) => !t.skipped && t.previewUrl).length;
  spEls.apply.textContent = matched ?
    'Use matched files (' + matched + ' of ' + sp.tracks.length + ')' : 'Use matched files';
  spEls.apply.disabled = matched === 0;
  spEls.previews.textContent = withPrev ?
    'Use 30s previews (' + withPrev + ')' : 'Use 30s previews';
  spEls.previews.disabled = withPrev === 0;
  const missing = sp.tracks.length - sp.tracks.filter((t) => t.file || t.skipped).length;
  spEls.applyHint.textContent =
    (missing > 0 ? missing + ' track' + (missing > 1 ? 's' : '') + ' still need' + (missing > 1 ? '' : 's') +
      ' a file \u2014 skip them, pick files manually, or use previews instead. ' : '') +
    (extras ? extras + ' extra file' + (extras > 1 ? 's' : '') + ' will be appended after the playlist.' : '');
  if (!spEls.applyHint.textContent) spEls.applyHint.textContent =
    'All set \u2014 hit \u201cUse matched files\u201d to load these into step 2 in playlist order.';
}

let pickIdx = -1;

function applyPlaylist() {
  const chosen = sp.tracks.filter((t) => t.file && !t.skipped);
  if (!chosen.length) {
    toast('No tracks have matching files yet \u2014 drop your audio files in step 2 first.', 'err');
    return;
  }
  audioItems = chosen.map((t) => ({
    file: t.file,
    name: (t.subtitle ? t.subtitle + ' \u2014 ' : '') + t.title
  }));
  sp.pool.forEach((f) => {
    if (f.__xtra && f.__t == null) audioItems.push({ file: f, name: f.name });
  });
  renderAudioList();
  const missing = sp.tracks.length - chosen.length;
  toast('Using ' + chosen.length + ' of ' + sp.tracks.length + ' playlist tracks' +
    (missing > 0 ? ' \u2014 ' + missing + ' skipped or without a file' : '') + '.');
  document.querySelector('#drop-audio').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function usePreviews() {
  if (busy) { toast('Wait for the current job to finish.', 'err'); return; }
  const chosen = sp.tracks.filter((t) => !t.skipped && t.previewUrl);
  if (!chosen.length) {
    toast('No playable previews here \u2014 tracks may be skipped or previews unavailable.', 'err');
    return;
  }
  const totalSec = chosen.length * 30;
  if (totalSec > 900) {
    toast('Heads up: ' + chosen.length + ' previews \u2248 ' + fmtTime(totalSec) +
      ' of audio \u2014 the video records in real time, so this will take a while.', 'err');
  }
  busy = true;
  document.body.classList.add('busy');
  updateMakeBtn();
  spShowProgress('Fetching previews\u2026 0/' + chosen.length);
  const items = [];
  let fail = 0;
  for (let i = 0; i < chosen.length; i++) {
    spSetProgress((i + 1) / chosen.length, 'Fetching previews\u2026 ' + (i + 1) + '/' + chosen.length);
    const t = chosen[i];
    const label = (t.subtitle ? t.subtitle + ' \u2014 ' : '') + t.title;
    try {
      const r = await fetchTimeout(t.previewUrl, {}, 20000);
      if (!r.ok) throw new Error('http ' + r.status);
      const b = await r.blob();
      if (b.size < 20000) throw new Error('too small');
      items.push({
        file: new File([b], label + '.mp3', { type: 'audio/mpeg' }),
        name: label + ' (30s preview)'
      });
    } catch (e) { fail++; }
  }
  spHideProgress();
  busy = false;
  document.body.classList.remove('busy');
  updateMakeBtn();
  if (!items.length) {
    toast('Could not fetch any previews \u2014 check your connection and try again.', 'err');
    return;
  }
  audioItems = items;
  renderAudioList();
  toast('Using ' + items.length + ' Spotify previews' +
    (fail ? ' \u2014 ' + fail + ' failed to load' : '') + '. Now pick a picture and make the video!');
  document.querySelector('#drop-image').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetSpotify() {
  stopPreview();
  sp.playlist = null;
  sp.tracks = [];
  sp.pool = [];
  spEls.panel.classList.add('hidden');
  spEls.error.classList.add('hidden');
  spHideProgress();
}

function forgetPlaylist() {
  if (!sp.playlist) return;
  const loose = sp.pool.slice();
  const added = loose.filter((f) =>
    !audioItems.some((it) => it.file === f));
  if (added.length) {
    audioItems = audioItems.concat(added.map((f) => ({ file: f, name: f.name })));
    renderAudioList();
  }
  resetSpotify();
  toast('Playlist forgotten' +
    (added.length ? ' \u2014 its ' + added.length + ' file' + (added.length > 1 ? 's' : '') +
      ' moved to your audio list.' : '.'));
}

/* ======================= audio engine ======================= */

async function decodeFile(file) {
  const c = audioCtx();
  const arr = await file.arrayBuffer();
  return await c.decodeAudioData(arr);
}

function concatToStereo(buffers) {
  const c = audioCtx();
  const rate = c.sampleRate;
  const len = buffers.reduce((s, b) => s + b.length, 0);
  const out = c.createBuffer(2, len, rate);
  const L = out.getChannelData(0), R = out.getChannelData(1);
  let o = 0;
  for (const b of buffers) {
    L.set(b.getChannelData(0), o);
    R.set(b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0), o);
    o += b.length;
  }
  return out;
}

async function loadSound(key, url, store) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arr = await res.arrayBuffer();
    store[key] = await audioCtx().decodeAudioData(arr);
  } catch (e) {
    console.warn('Could not load party sound "' + key + '":', e);
    if (key === 'talking') { els.optTalking.checked = false; els.optTalking.disabled = true; }
    toast('Couldn\u2019t load the "' + key + '" sound — continuing without it.', 'err');
  }
}

/* Tiled-bathroom reverb impulse: bright noise burst with fast decay
   + a few discrete early reflections (tile slap). Normalized to
   unit energy so the wet level is predictable. */
function bathroomIR(off, seconds, decayPow) {
  seconds = seconds || 1.3; decayPow = decayPow || 3.0;
  const rate = off.sampleRate, len = Math.floor(rate * seconds);
  const ir = off.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let energy = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decayPow) * (1 - Math.exp(-i / (0.006 * rate)));
      const x = (Math.random() * 2 - 1) * env;
      d[i] = x; energy += x * x;
    }
    const refl = [[0.011, 0.6], [0.019, -0.45], [0.031, 0.5], [0.047, -0.35], [0.071, 0.28]];
    refl.forEach((r, k) => {
      if ((k + ch) % 2 === 0) {
        const idx = Math.floor(r[0] * rate);
        if (idx < len) d[idx] += r[1] * (Math.random() < 0.5 ? 1 : -1);
      }
    });
    const norm = 1 / Math.sqrt(energy + 1e-9);
    for (let i = 0; i < len; i++) d[i] *= norm;
  }
  return ir;
}

/* One layer of crowd murmur: copies of the talking clip scattered
   through the track at random pans, loudness and pitch. */
function crowdLayer(off, buf, dur, vol, gapMul, master, verbBus) {
  const hasPan = !!off.createStereoPanner;
  let t = 0.4 + Math.random() * 2.5;
  let guard = 0;
  while (t < dur - 0.6 && guard++ < 500) {
    const rate = 0.86 + Math.random() * 0.3;
    const clipDur = buf.duration / rate;
    /* if the whole clip doesn't fit, play a random slice of it so
       short tracks still get chatter */
    let playDur = clipDur;
    let offset = 0;
    if (t + clipDur > dur - 0.15) {
      playDur = dur - 0.15 - t;
      if (playDur < 1.5) break;
      offset = Math.random() * Math.max(0, buf.duration - playDur * rate);
    }
    const end = t + playDur;

    const src = off.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;

    const lp = off.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300 + Math.random() * 900;
    lp.Q.value = 0.3;

    const g = off.createGain();
    const peak = (0.35 + Math.random() * 0.6) * vol;
    const fadeIn = Math.min(0.2, playDur * 0.25);
    const fadeOut = Math.min(0.25, playDur * 0.25);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + fadeIn);
    g.gain.setValueAtTime(peak, Math.max(t + fadeIn, end - fadeOut));
    g.gain.linearRampToValueAtTime(0, end);

    let out = g;
    if (hasPan) {
      const p = off.createStereoPanner();
      p.pan.value = Math.random() * 1.8 - 0.9;
      g.connect(p); out = p;
    }
    src.connect(lp); lp.connect(g);
    out.connect(master);

    const send = off.createGain();
    send.gain.value = 0.22 * vol;
    out.connect(send); send.connect(verbBus);

    src.start(t, offset, playDur * rate);
    src.stop(end + 0.05);
    t = end + (0.3 + Math.random() * 3) / gapMul;
  }
}

function placeDoor(off, buf, t, vol, master, verbBus) {
  const src = off.createBufferSource();
  src.buffer = buf;
  const lp = off.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3400;
  lp.Q.value = 0.3;
  const g = off.createGain();
  g.gain.value = vol;
  let out = g;
  if (off.createStereoPanner) {
    const p = off.createStereoPanner();
    p.pan.value = Math.random() * 0.9 - 0.45;
    g.connect(p); out = p;
  }
  src.connect(lp); lp.connect(g);
  out.connect(master);
  const send = off.createGain();
  send.gain.value = 0.5 * vol;
  out.connect(send); send.connect(verbBus);
  src.start(t);
}

/* Doors: a pair of open+close sounds every ~16-36 s.
   While a door is open the music swells and gets brighter —
   more of the party pours in — then it shuts again. */
function scheduleDoors(off, opts, dur, master, verbBus, duck, lpA, lpB) {
  const vol = opts.volume;
  const evs = [];
  let t = 4 + Math.random() * 8;
  while (t < dur - 6) {
    evs.push({ open: t, close: Math.min(t + 1.8 + Math.random() * 2.4, dur - 1.5) });
    t += 16 + Math.random() * 20;
  }
  if (!evs.length && dur > 4) evs.push({ open: 1.5, close: Math.min(3.5, dur - 1.5) });

  for (const e of evs) {
    placeDoor(off, opts.sounds.doorOpen, e.open, (0.7 + Math.random() * 0.25) * vol, master, verbBus);
    placeDoor(off, opts.sounds.doorClose, e.close, (0.8 + Math.random() * 0.3) * vol, master, verbBus);
  }

  const hi = Math.min(3600, opts.muffle * 2.6);
  for (const e of evs) {
    duck.gain.setValueAtTime(1, e.open);
    duck.gain.linearRampToValueAtTime(1.7, e.open + 0.3);
    duck.gain.setValueAtTime(1.7, e.close);
    duck.gain.linearRampToValueAtTime(1, e.close + 0.7);
    [lpA, lpB].forEach(f => {
      const fq = f.frequency;
      fq.setValueAtTime(opts.muffle, e.open);
      fq.linearRampToValueAtTime(hi, e.open + 0.3);
      fq.setValueAtTime(hi, e.close);
      fq.linearRampToValueAtTime(opts.muffle, e.close + 0.7);
    });
  }
}

/* The big one: renders music + party sounds + bathroom acoustics
   offline (much faster than realtime). */
async function renderPartyAudio(music, opts) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const rate = music.sampleRate;
  const dur = music.duration;
  const total = dur + 1.4;                      // room for the reverb tail
  const off = new OAC(2, Math.ceil(total * rate), rate);

  const master = off.createGain();
  master.gain.value = 0.85;
  const comp = off.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 18; comp.ratio.value = 5;
  comp.attack.value = 0.008; comp.release.value = 0.28;
  master.connect(comp); comp.connect(off.destination);

  const verb = off.createConvolver();
  verb.buffer = bathroomIR(off);
  const verbBus = off.createGain();
  verbBus.connect(verb);
  const verbOut = off.createGain();
  verbOut.gain.value = 0.85;
  verb.connect(verbOut); verbOut.connect(master);

  /* --- your music, through the wall --- */
  const mSrc = off.createBufferSource();
  mSrc.buffer = music;
  const lpA = off.createBiquadFilter();
  lpA.type = 'lowpass'; lpA.frequency.value = opts.muffle; lpA.Q.value = 0.4;
  const lpB = off.createBiquadFilter();
  lpB.type = 'lowpass'; lpB.frequency.value = opts.muffle; lpB.Q.value = 0.4;
  const mLevel = off.createGain();
  const duck = off.createGain();
  duck.gain.value = 1;
  mSrc.connect(lpA); lpA.connect(lpB); lpB.connect(mLevel);
  mLevel.connect(duck); duck.connect(master);
  const mSend = off.createGain();
  mSend.gain.value = 0.3;
  duck.connect(mSend); mSend.connect(verbBus);

  mLevel.gain.setValueAtTime(0, 0);
  mLevel.gain.linearRampToValueAtTime(1.15, Math.min(0.5, Math.max(0.03, dur * 0.2)));
  if (dur > 0.8) {
    mLevel.gain.setValueAtTime(1.15, dur - 0.35);
    mLevel.gain.linearRampToValueAtTime(0, dur - 0.02);
  }
  mSrc.start(0);

  /* --- party sounds --- */
  if (opts.doors && opts.sounds.doorOpen && opts.sounds.doorClose) {
    scheduleDoors(off, opts, dur, master, verbBus, duck, lpA, lpB);
  }
  if (opts.talking && opts.sounds.talking) {
    crowdLayer(off, opts.sounds.talking, dur, opts.volume, 1, master, verbBus);
    crowdLayer(off, opts.sounds.talking, dur, opts.volume * 0.65, 1.5, master, verbBus);
  }

  /* --- smooth ending (let the reverb ring, then fade) --- */
  if (total > 1.4) {
    master.gain.setValueAtTime(0.85, total - 1.15);
    master.gain.linearRampToValueAtTime(0.0001, total - 0.05);
  }

  return await off.startRendering();
}

/* ======================= video recorder ======================= */

async function loadBitmap(file) {
  try { return await createImageBitmap(file); }
  catch (e) {
    return await new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read the picture.')); };
      img.src = url;
    });
  }
}

function pickDims(bmp) {
  let w = bmp.width || 1280, h = bmp.height || 720;
  const s = Math.min(1, 1920 / Math.max(w, h));   // cap the long side
  w = Math.round(w * s); h = Math.round(h * s);
  const up = Math.max(1, 640 / Math.min(w, h));   // lift tiny pictures
  w = Math.round(w * up); h = Math.round(h * up);
  w -= w % 2; h -= h % 2;                        // even numbers for encoders
  return [Math.max(2, w), Math.max(2, h)];
}

function pickMime() {
  const cands = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4'
  ];
  for (const c of cands) {
    try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c; } catch (e) {}
  }
  return '';
}

function recordVideo(bitmap, audio, onPct) {
  return new Promise((resolve, reject) => {
    const dims = pickDims(bitmap);
    const W = dims[0], H = dims[1];
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';

    const draw = (p) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      const zoom = 1 + 0.06 * p;                 // subtle slow zoom
      const dw = W * zoom, dh = H * zoom;
      const dx = (W - dw) / 2 + Math.sin(p * Math.PI) * W * 0.012;
      const dy = (H - dh) / 2 - Math.sin(p * Math.PI) * H * 0.008;
      g.drawImage(bitmap, dx, dy, dw, dh);
    };
    draw(0);

    const stream = canvas.captureStream(30);
    const c = audioCtx();
    const dest = c.createMediaStreamDestination();
    const src = c.createBufferSource();
    src.buffer = audio;
    src.connect(dest);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));

    const mime = pickMime();
    const recOpts = { videoBitsPerSecond: 8000000, audioBitsPerSecond: 192000 };
    if (mime) recOpts.mimeType = mime;
    let rec;
    try { rec = new MediaRecorder(stream, recOpts); }
    catch (e) { reject(new Error('This browser cannot record video (' + e.message + ').')); return; }

    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => { ended = true; reject(new Error('Recording failed: ' + (e.error && e.error.name || 'error'))); try { rec.stop(); } catch (x) {} };

    let raf = 0, watch = 0, ended = false, failed = null;
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      cancelAnimationFrame(raf);
      clearInterval(watch);
      if (failed) reject(failed);
      else resolve(new Blob(chunks, { type: mime || 'video/webm' }));
    };

    const dur = audio.duration;
    const t0 = c.currentTime + 0.15;
    src.onended = finish;
    function finish() {
      if (ended) return;
      ended = true;
      try { if (rec.state === 'recording') rec.stop(); } catch (e) {}
    }
    watch = setInterval(() => {
      if (c.currentTime - t0 >= dur + 0.25) finish();
    }, 400);

    rec.start(800);
    src.start(t0);

    /* if the audio clock never started (browser blocked audio), bail out loudly */
    const initial = c.currentTime;
    setTimeout(() => {
      if (!ended && c.currentTime < initial + 0.05) {
        failed = new Error('Audio is blocked by the browser — click anywhere on the page and try again.');
        finish();
      }
    }, 3000);

    const loop = () => {
      if (ended) return;
      const t = c.currentTime - t0;
      const p = Math.max(0, Math.min(1, t / dur));
      onPct(p);
      draw(p);
      if (p >= 1) { finish(); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  });
}

/* Chrome records WebM without a duration header, which makes the
   <video> preview show "Infinity" — this nudges it to compute it. */
function fixWebmDuration(v) {
  const onMeta = () => {
    if (v.duration === Infinity || Number.isNaN(v.duration)) {
      const onTime = () => { v.removeEventListener('timeupdate', onTime); v.currentTime = 0; };
      v.addEventListener('timeupdate', onTime);
      v.currentTime = 1e6;
    }
    v.removeEventListener('loadedmetadata', onMeta);
  };
  v.addEventListener('loadedmetadata', onMeta);
}

/* ======================= main flow ======================= */

function supported() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    toast('This browser can\u2019t record video — try desktop Chrome, Edge or Firefox.', 'err');
    return false;
  }
  return true;
}

async function makeVideo() {
  if (busy) return;
  if (!supported()) return;
  if (!audioItems.length) { toast('Add at least one audio file.', 'err'); return; }
  if (!imageFile) { toast('Add a picture first.', 'err'); return; }

  busy = true;
  document.body.classList.add('busy');
  updateMakeBtn();
  els.result.classList.add('hidden');
  leaveGuard = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', leaveGuard);

  try {
    await ensureRunning();

    const useTalking = els.optTalking.checked && !els.optTalking.disabled;
    const useDoors = els.optDoors.checked && !els.optDoors.disabled;
    const muffle = +els.optMuffle.value;
    const volume = +els.optVolume.value / 100;

    /* phase 1 — decode the user's audio (0 → 30 %) */
    const buffers = [];
    for (let i = 0; i < audioItems.length; i++) {
      setProgress(30 * (i / audioItems.length),
        'Reading ' + audioItems[i].name + ' (' + (i + 1) + '/' + audioItems.length + ')…');
      try { buffers.push(await decodeFile(audioItems[i].file)); }
      catch (e) { throw new Error('Could not decode "' + audioItems[i].name + '". Is it a valid audio file?'); }
    }
    const music = concatToStereo(buffers);
    if (music.duration < 1) throw new Error('Your audio is too short to process.');
    const mins = Math.max(1, Math.ceil((music.duration + 10) / 60));
    if (music.duration > 900) toast('Heads up: long audio = long wait (and lots of memory). Recording happens in real time.', 'err');

    /* phase 2 — fetch the party sounds (30 → 40 %) */
    setProgress(30, 'Loading party sounds…');
    const sounds = {};
    const loads = [];
    if (useTalking) loads.push(loadSound('talking', PARTY_SOUNDS.talking, sounds));
    if (useDoors) {
      loads.push(loadSound('doorOpen', PARTY_SOUNDS.doorOpen, sounds));
      loads.push(loadSound('doorClose', PARTY_SOUNDS.doorClose, sounds));
    }
    await Promise.all(loads);

    /* phase 3 — offline render of the bathroom mix (40 → 50 %) */
    setProgress(40, 'Mixing the bathroom party sound…', { indeterminate: true });
    const finalAudio = await renderPartyAudio(music, { sounds, talking: useTalking, doors: useDoors, muffle, volume });

    /* phase 4 — record the video in real time (50 → 100 %) */
    const bitmap = await loadBitmap(imageFile);
    const blob = await recordVideo(bitmap, finalAudio, (p) => {
      setProgress(50 + p * 50,
        'Recording your video… keep this tab visible (takes about ' + mins + ' min)');
    });
    setProgress(100, 'Done — your video is ready below!');

    /* phase 5 — show it */
    const url = URL.createObjectURL(blob);
    if (els.video.src && els.video.src.startsWith('blob:')) URL.revokeObjectURL(els.video.src);
    els.video.src = url;
    fixWebmDuration(els.video);
    const ext = (blob.type || '').includes('mp4') ? 'mp4' : 'webm';
    els.download.href = url;
    els.download.setAttribute('download', 'bathroom-party-video.' + ext);
    els.info.textContent = (blob.type.split(';')[0] || 'video') + ' · ' + fmtSize(blob.size) +
      ' · ' + fmtTime(finalAudio.duration) + ' long';
    els.result.classList.remove('hidden');
    els.video.play().catch(() => {});
    els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    toast(err && err.message ? err.message : 'Something went wrong — check the browser console.', 'err');
    setProgress(0, 'Failed. Fix the issue above and try again.');
  } finally {
    busy = false;
    document.body.classList.remove('busy');
    updateMakeBtn();
    window.removeEventListener('beforeunload', leaveGuard);
  }
}

function startOver() {
  audioItems = [];
  imageFile = null;
  resetSpotify();
  spEls.url.value = '';
  spSyncHelperCmd();
  if (els.video.src && els.video.src.startsWith('blob:')) URL.revokeObjectURL(els.video.src);
  els.video.removeAttribute('src'); els.video.load();
  if (els.imageThumb.src && els.imageThumb.src.startsWith('blob:')) URL.revokeObjectURL(els.imageThumb.src);
  els.imageThumb.removeAttribute('src');
  els.imagePreview.classList.add('hidden');
  els.dropImage.classList.remove('slim');
  els.result.classList.add('hidden');
  els.status.classList.add('hidden');
  renderAudioList();
  updateMakeBtn();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ======================= wiring ======================= */

els.browseAudio.addEventListener('click', () => els.audioInput.click());
els.browseImage.addEventListener('click', () => els.imageInput.click());

els.dropAudio.addEventListener('click', (e) => { if (e.target.closest('button')) return; els.audioInput.click(); });
els.dropImage.addEventListener('click', (e) => { if (e.target.closest('button')) return; els.imageInput.click(); });

['keydown'].forEach(ev => {
  els.dropAudio.addEventListener(ev, (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.audioInput.click(); } });
  els.dropImage.addEventListener(ev, (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.imageInput.click(); } });
});

els.audioInput.addEventListener('change', (e) => { addAudioFiles([...e.target.files]); e.target.value = ''; });
els.imageInput.addEventListener('change', (e) => { setImage(e.target.files[0]); e.target.value = ''; });

/* whole-folder picking (the helper script's spotify-tracks folder) */
els.browseFolder.addEventListener('click', () => els.folderInput.click());
els.folderInput.addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  const audio = files.filter(isAudioFile);
  if (!audio.length) { toast('No audio files found in that folder.', 'err'); return; }
  audio.sort((a, b) => (a.webkitRelativePath || a.name)
    .localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true, sensitivity: 'base' }));
  addAudioFiles(audio);
});

function wireDrop(zone, onFiles) {
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('drag');
  }));
  zone.addEventListener('drop', (e) => {
    if (!e.dataTransfer) return;
    /* capture plain files NOW — the DataTransfer dies with this event */
    const plainFiles = e.dataTransfer.files ? [...e.dataTransfer.files] : [];
    /* dragged folders arrive as entries, not files — walk them first */
    filesFromDataTransfer(e.dataTransfer).then((files) => {
      if (files && files.length) { onFiles(files); return; }
      if (plainFiles.length) onFiles(plainFiles);
    });
  });
}
wireDrop(els.dropAudio, addAudioFiles);
wireDrop(els.dropImage, (files) =>
  setImage(files.find(isImageFile) || files[0]));

/* Walks a DataTransfer's items, recursing into dropped directories
   (Chromium/WebKit/Firefox entries API). Returns null when the drop
   was plain files — caller then uses dataTransfer.files. */
function filesFromDataTransfer(dt) {
  const items = dt.items ? [...dt.items] : [];
  const entries = [];
  for (const it of items) {
    if (it.kind === 'file' && it.webkitGetAsEntry) {
      const ent = it.webkitGetAsEntry();
      if (ent) entries.push(ent);
    }
  }
  if (!entries.length) return Promise.resolve(null);
  const out = [];
  const walk = (entry) => new Promise((res) => {
    if (entry.isFile) {
      entry.file((f) => { out.push(f); res(); }, () => res());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () => reader.readEntries(async (batch) => {
        if (!batch.length) { res(); return; }
        for (const e of batch) await walk(e);
        readAll();                     /* readEntries yields ≤100 at a time */
      }, () => res());
      readAll();
    } else res();
  });
  return Promise.all(entries.map(walk)).then(() => {
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return out;
  });
}

els.audioClear.addEventListener('click', () => { audioItems = []; renderAudioList(); });
els.optMuffle.addEventListener('input', () => { els.muffleVal.textContent = els.optMuffle.value + ' Hz'; });
els.optVolume.addEventListener('input', () => { els.volumeVal.textContent = els.optVolume.value + '%'; });
els.makeBtn.addEventListener('click', makeVideo);
els.remake.addEventListener('click', startOver);

/* ---- spotify wiring ---- */
spEls.importBtn.addEventListener('click', importPlaylist);
spEls.url.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); importPlaylist(); }
});
spEls.forget.addEventListener('click', forgetPlaylist);
spEls.apply.addEventListener('click', applyPlaylist);
spEls.previews.addEventListener('click', usePreviews);
spEls.connectBtn.addEventListener('click', spLogin);
spEls.pick.addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f && pickIdx >= 0 && sp.tracks[pickIdx] && isAudioFile(f)) {
    const t = sp.tracks[pickIdx];
    if (t.file) t.file.__t = null;
    f.__t = pickIdx;
    f.__xtra = false;
    sp.pool.push(f);
    t.file = f;
    t.manual = true;
    runMatcher();
    renderSpPanel();
  } else if (f && !isAudioFile(f)) {
    toast('That file is not audio.', 'err');
  }
  pickIdx = -1;
});
spEls.redirect.textContent = location.origin + location.pathname;
const savedCid = localStorage.getItem('bpvm_cid');
if (savedCid) spEls.cid.value = savedCid;
spHandleCallback();

/* ---- helper-script box: live command, copy button, playlist.json ---- */

function spHelperCmdText() {
  const u = spEls.url.value.trim();
  const ok = u && parseSpotifyInput(u).ok;
  return 'python3 spotify_helper.py ' +
    (ok ? '"' + u + '"' : '"https://open.spotify.com/playlist/\u2026"');
}
function spSyncHelperCmd() { spEls.helperCmd.textContent = spHelperCmdText(); }
spEls.url.addEventListener('input', spSyncHelperCmd);
spSyncHelperCmd();

function copyText(txt, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done, () => copyFallback(txt, done));
  } else copyFallback(txt, done);
}
function copyFallback(txt, done) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); }
  catch (e) { toast('Copy didn\u2019t work — select the command text yourself.', 'err'); }
  ta.remove();
}
spEls.helperCopy.addEventListener('click', () => {
  copyText(spEls.helperCmd.textContent, () => toast('Command copied — paste it into a terminal.'));
});

spEls.loadJson.addEventListener('click', () => spEls.jsonInput.click());
spEls.jsonInput.addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) loadPlaylistJson(f);
});

async function loadPlaylistJson(file) {
  if (busy) { toast('Wait for the current job to finish.', 'err'); return; }
  let j = null;
  try { j = JSON.parse(await file.text()); }
  catch (e) {
    toast('That\u2019s not valid JSON — pick the playlist.json the helper script saved.', 'err');
    return;
  }
  const tracks = (Array.isArray(j && j.tracks) ? j.tracks : [])
    .filter((t) => t && (t.title || t.artist));
  if (!tracks.length) { toast('That playlist.json doesn\u2019t contain any tracks.', 'err'); return; }
  stopPreview();
  sp.playlist = {
    id: 'json:' + (j.name || file.name),
    name: j.name || 'Playlist',
    cover: j.cover || '',
    url: j.url || '',
    via: 'helper'
  };
  sp.tracks = tracks.map((t) => ({
    title: t.title || '',
    subtitle: t.artist || '',
    durMs: t.durMs || 0,
    previewUrl: t.previewUrl || null,
    uri: null,
    key: normKey(((t.artist || '') + ' ' + (t.title || '')).trim()),
    file: null,
    manual: false,
    skipped: false
  }));
  sp.pool = [];
  runMatcher();
  spHideProgress();
  spEls.error.classList.add('hidden');
  spEls.connect.classList.add('hidden');
  renderSpPanel();
  const totMs = sp.tracks.reduce((s, t) => s + (t.durMs || 0), 0);
  toast('Loaded \u201c' + sp.playlist.name + '\u201d \u2014 ' + sp.tracks.length + ' tracks' +
    (totMs ? ' \u00b7 ' + fmtTime(totMs / 1000) : '') + '.');
  spEls.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

renderAudioList();
updateMakeBtn();
