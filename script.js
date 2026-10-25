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
  audioItems = audioItems.concat(ok.map(f => ({ file: f, name: f.name })));
  renderAudioList();
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
  if (!f.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)) {
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

function wireDrop(zone, onFiles) {
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('drag');
  }));
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      onFiles([...e.dataTransfer.files]);
    }
  });
}
wireDrop(els.dropAudio, addAudioFiles);
wireDrop(els.dropImage, (files) => setImage(files[0]));

els.audioClear.addEventListener('click', () => { audioItems = []; renderAudioList(); });
els.optMuffle.addEventListener('input', () => { els.muffleVal.textContent = els.optMuffle.value + ' Hz'; });
els.optVolume.addEventListener('input', () => { els.volumeVal.textContent = els.optVolume.value + '%'; });
els.makeBtn.addEventListener('click', makeVideo);
els.remake.addEventListener('click', startOver);

renderAudioList();
updateMakeBtn();
