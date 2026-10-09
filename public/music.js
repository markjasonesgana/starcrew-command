/*!
 * Starcrew radio: an original space soundtrack, synthesised live in the browser
 * with Web Audio. No audio files, nothing downloaded, nothing copyrighted.
 * Each track is a small "score" (key, chords, grooves) and a seeded composer
 * writes its melodies, so a track sounds the same every time it plays.
 */
(function (global) {
  'use strict';
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  };
  // sections: [bars, parts]. parts letters: p pad, b bass, a arp, d drums, A/B lead phrase, k keys, e bells
  const TRACKS = [
    { title: 'Launch Window', mood: 'bright chiptune', bpm: 118, root: 60, scale: 'major', prog: [0, 4, 5, 3], per: 1, seed: 11,
      lead: 'square', arp: 'square', pad: 0.9, bass: 'R...R.R.R...R.R.', arpPat: '0.1.2.1.0.1.2.3.', drums: { k: 'x.......x.x.....', s: '....x.......x...', h: '..x...x...x...x.' },
      sections: [[4, 'pa'], [8, 'pabd'], [8, 'pabdA'], [8, 'pabdB'], [4, 'pa'], [8, 'pabdA'], [8, 'pabdB'], [8, 'pabdA'], [4, 'p']] },
    { title: 'Nebula Drift', mood: 'ambient, slow', bpm: 66, root: 62, scale: 'dorian', prog: [0, 5, 3, 4], per: 2, seed: 23,
      lead: 'triangle', arp: 'sine', pad: 0.6, bass: 'R...............', arpPat: '0...2...1...3...', drums: null, density: 0.35,
      sections: [[8, 'pe'], [8, 'pbe'], [8, 'pbeA'], [8, 'pbea'], [8, 'pbeB'], [8, 'pe']] },
    { title: 'Orbit Café', mood: 'lo-fi chill', bpm: 84, root: 63, scale: 'major', prog: [1, 4, 0, 5], per: 1, seed: 37, swing: 0.2, sevenths: true,
      lead: 'triangle', arp: 'triangle', pad: 0.5, bass: 'R.....F...R...O.', arpPat: '', drums: { k: 'x.........x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' }, soft: true, density: 0.5,
      sections: [[4, 'kd'], [8, 'kbd'], [8, 'kbdA'], [8, 'kbdB'], [4, 'kb'], [8, 'kbdA'], [8, 'kbdB'], [4, 'k']] },
    { title: 'Asteroid Belt Run', mood: 'fast and driving', bpm: 140, root: 57, scale: 'minor', prog: [0, 5, 2, 6], per: 1, seed: 53,
      lead: 'sawtooth', arp: 'square', pad: 0.7, bass: 'R.R.R.R.R.R.F.O.', arpPat: '0120312001203123', drums: { k: 'x...x...x...x...', s: '....x.......x..x', h: 'xxxxxxxxxxxxxxxx' }, density: 0.75,
      sections: [[4, 'ab'], [8, 'abd'], [8, 'pabdA'], [8, 'pabdB'], [4, 'pa'], [8, 'pabdA'], [8, 'pabdB'], [8, 'pabdA'], [8, 'abd'], [4, 'p']] },
    { title: 'Moonbase Night Shift', mood: 'mellow, late night', bpm: 92, root: 53, scale: 'minor', prog: [0, 5, 3, 4], per: 2, seed: 71, swing: 0.12, sevenths: true,
      lead: 'triangle', arp: 'sine', pad: 0.5, bass: 'R.......R.....F.', arpPat: '0..1..2..1..3...', drums: { k: 'x.......x.......', s: '........x.......', h: '..x...x...x...x.' }, soft: true, density: 0.45,
      sections: [[8, 'pa'], [8, 'pabd'], [8, 'pabdA'], [8, 'pabdB'], [8, 'pabe'], [8, 'pabdA'], [4, 'p']] },
    { title: 'Starcrew Anthem', mood: 'heroic theme', bpm: 108, root: 55, scale: 'mixolydian', prog: [0, 6, 3, 0], per: 1, seed: 97,
      lead: 'square', arp: 'square', pad: 1, bass: 'R.......R.R.F...', arpPat: '0.2.1.2.0.2.1.3.', drums: { k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' }, density: 0.65,
      sections: [[4, 'p'], [8, 'pabd'], [8, 'pabdA'], [8, 'pabdA'], [8, 'pabdB'], [4, 'pa'], [8, 'pabdA'], [8, 'pabdB'], [4, 'p']] },
  ];
  for (const t of TRACKS) { t.bars = t.sections.reduce((n, s) => n + s[0], 0); t.seconds = t.bars * 4 * 60 / t.bpm; }

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const deg = (t, d) => { const sc = SCALES[t.scale], n = sc.length; const o = Math.floor(d / n); return t.root + sc[((d % n) + n) % n] + 12 * o; };
  const chordTones = (t, d) => [d, d + 2, d + 4, ...(t.sevenths ? [d + 6] : [])];

  // the composer: two melodic phrases (A and B) per chord, written once per track
  function compose(t) {
    const R = rng(t.seed), dens = t.density == null ? 0.6 : t.density;
    const make = variant => {
      let cur = 9 + Math.floor(R() * 3);
      return t.prog.map((c, ci) => {
        const steps = new Array(16 * t.per).fill(null);
        const tones = chordTones(t, c).flatMap(x => [x + 7, x + 14]).filter(x => x >= 6 && x <= 18);
        for (let s = 0; s < steps.length; s += 2) {
          const strong = s % 8 === 0;
          if (!strong && R() > dens) continue;
          if (strong || R() < 0.45) cur = tones.reduce((b, x) => Math.abs(x - cur) < Math.abs(b - cur) ? x : b, tones[0]) + (R() < 0.25 ? (R() < 0.5 ? 2 : -2) : 0);
          else cur += [-2, -1, -1, 1, 1, 2][Math.floor(R() * 6)];
          cur = Math.max(5, Math.min(18, cur));
          steps[s] = cur;
          if (variant === 'B' && R() < 0.25 && s + 1 < steps.length) steps[s + 1] = cur + 1;
        }
        if (ci === t.prog.length - 1) { steps.fill(null, steps.length / 2); steps[steps.length / 2] = 7 + (variant === 'A' ? 0 : 2); }
        return steps;
      });
    };
    t.A = make('A'); t.B = make('B');
  }
  TRACKS.forEach(compose);

  function createRadio() {
    let ctx = null, master = null, bus = null, echo = null, verb = null, noise = null;
    let playing = false, track = 0, step = 0, nextTime = 0, timer = null, vol = 0.35, shuffle = false, repeat = 'all', startedAt = 0, pausedBar = 0;
    const listeners = {};
    const emit = (e, d) => (listeners[e] || []).forEach(f => { try { f(d); } catch (x) { /* ignore */ } });

    function init() {
      if (ctx) return;
      ctx = new (global.AudioContext || global.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
      master.connect(comp).connect(ctx.destination);
      bus = ctx.createGain(); bus.connect(master);
      // space reverb: a long, dark, decaying tail
      verb = ctx.createConvolver();
      const len = ctx.sampleRate * 3.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
      verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.32; verb.connect(vg).connect(master);
      // ping-pong-ish echo for arps and leads
      echo = ctx.createDelay(1.5); const fb = ctx.createGain(); fb.gain.value = 0.32; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      echo.connect(lp).connect(fb).connect(echo); const eg = ctx.createGain(); eg.gain.value = 0.28; lp.connect(eg).connect(master);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    const out = (node, { wet = 0.3, delay = 0 } = {}) => {
      node.connect(bus);
      if (wet) { const g = ctx.createGain(); g.gain.value = wet; node.connect(g).connect(verb); }
      if (delay) { const g = ctx.createGain(); g.gain.value = delay; node.connect(g).connect(echo); }
    };
    function env(g, t0, a, peak, d, sus, rel, end) {
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), t0 + a + d);
      g.gain.setValueAtTime(Math.max(0.0001, peak * sus), end); g.gain.exponentialRampToValueAtTime(0.0001, end + rel);
    }
    function osc(type, freq, t0, t1, detune = 0) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune; o.start(t0); o.stop(t1); return o; }

    // ---------- instruments ----------
    function pad(t, notes, t0, dur) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(500 + 900 * t.pad, t0); f.frequency.linearRampToValueAtTime(800 + 1400 * t.pad, t0 + dur * 0.6); f.Q.value = 0.7;
      const g = ctx.createGain(); env(g, t0, Math.min(1.2, dur * 0.35), 0.05, 0.3, 0.8, 1.2, t0 + dur);
      for (const m of notes) for (const dt of [-7, 7]) osc('sawtooth', mtof(m), t0, t0 + dur + 1.4, dt).connect(f);
      f.connect(g); out(g, { wet: 0.55 });
    }
    function keys(notes, t0, dur) { // soft electric piano
      for (const m of notes) {
        const g = ctx.createGain(); env(g, t0, 0.01, 0.07, 0.6, 0.35, 0.5, t0 + dur);
        osc('sine', mtof(m), t0, t0 + dur + 0.6).connect(g); const g2 = ctx.createGain(); g2.gain.value = 0.3; osc('triangle', mtof(m + 12), t0, t0 + dur + 0.6).connect(g2).connect(g);
        out(g, { wet: 0.35, delay: 0.1 });
      }
    }
    function bass(m, t0, dur, soft) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = soft ? 500 : 900;
      const g = ctx.createGain(); env(g, t0, 0.01, soft ? 0.16 : 0.2, 0.18, 0.55, 0.08, t0 + dur * 0.9);
      osc('triangle', mtof(m), t0, t0 + dur + 0.2).connect(f); osc('sine', mtof(m - 12), t0, t0 + dur + 0.2).connect(f);
      f.connect(g); out(g, { wet: 0.05 });
    }
    function pluck(type, m, t0, len, peak) {
      const g = ctx.createGain(); env(g, t0, 0.005, peak, len, 0.0001, 0.02, t0 + len);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
      osc(type, mtof(m), t0, t0 + len + 0.1).connect(f).connect(g); out(g, { wet: 0.3, delay: 0.5 });
    }
    function bell(m, t0) {
      const g = ctx.createGain(); env(g, t0, 0.005, 0.05, 1.6, 0.0001, 0.1, t0 + 1.6);
      osc('sine', mtof(m), t0, t0 + 1.8).connect(g); const g2 = ctx.createGain(); g2.gain.value = 0.25; osc('sine', mtof(m) * 2.76, t0, t0 + 0.8).connect(g2).connect(g);
      out(g, { wet: 0.7, delay: 0.5 });
    }
    function lead(type, m, t0, dur) {
      const o = osc(type, mtof(m), t0, t0 + dur + 0.3);
      const lfo = osc('sine', 5.2, t0, t0 + dur + 0.3); const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t0); lg.gain.linearRampToValueAtTime(9, t0 + Math.min(0.25, dur)); lfo.connect(lg).connect(o.detune);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = type === 'sawtooth' ? 2200 : 3400;
      const g = ctx.createGain(); env(g, t0, 0.02, type === 'triangle' ? 0.11 : 0.06, 0.12, 0.7, 0.12, t0 + dur);
      o.connect(f).connect(g); out(g, { wet: 0.3, delay: 0.35 });
    }
    function drum(kind, t0, soft) {
      const k = soft ? 0.6 : 1;
      if (kind === 'k') {
        const o = osc('sine', 150, t0, t0 + 0.35); o.frequency.exponentialRampToValueAtTime(42, t0 + 0.12);
        const g = ctx.createGain(); env(g, t0, 0.003, 0.55 * k, 0.25, 0.0001, 0.02, t0 + 0.27); o.connect(g); out(g, { wet: 0 });
      } else {
        const src = ctx.createBufferSource(); src.buffer = noise;
        const f = ctx.createBiquadFilter(); f.type = kind === 'h' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'h' ? 7000 : 1700;
        const len = kind === 'h' ? 0.035 : 0.16;
        const g = ctx.createGain(); env(g, t0, 0.002, (kind === 'h' ? 0.07 : 0.22) * k, len, 0.0001, 0.02, t0 + len);
        src.connect(f).connect(g); src.start(t0); src.stop(t0 + len + 0.05); out(g, { wet: kind === 's' ? 0.2 : 0 });
      }
    }

    // ---------- sequencer ----------
    function sectionAt(t, bar) { let b = 0; for (const s of t.sections) { if (bar < b + s[0]) return { parts: s[1], start: b, bars: s[0] }; b += s[0]; } return null; }
    function scheduleStep(s, time) {
      const t = TRACKS[track], spb = 60 / t.bpm / 4;
      const bar = Math.floor(s / 16), pos = s % 16;
      const sec = sectionAt(t, bar); if (!sec) return false;
      const P = sec.parts, ci = Math.floor(bar / t.per) % t.prog.length, chord = t.prog[ci];
      const tones = chordTones(t, chord), at = time + (pos % 2 ? (t.swing || 0) * spb : 0);
      const chordLen = t.per * 16;
      const posInChord = (bar % t.per) * 16 + pos;
      if (P.includes('p') && posInChord === 0) pad(t, tones.slice(0, 3).map(d => deg(t, d) - 12), at, chordLen * spb);
      if (P.includes('k') && (pos === 0 || pos === 10)) keys(tones.map(d => deg(t, d)), at, (pos === 0 ? 10 : 6) * spb);
      if (P.includes('b')) {
        const ch = t.bass[pos];
        if (ch && ch !== '.') { let len = 1; while (pos + len < 16 && t.bass[pos + len] === '.') len++; bass(deg(t, chord) - 24 + (ch === 'F' ? 7 : ch === 'O' ? 12 : 0), at, len * spb, t.soft); }
      }
      if (P.includes('a') && t.arpPat) { const c = t.arpPat[pos]; if (c && c !== '.') pluck(t.arp, deg(t, tones[Math.min(+c, tones.length - 1)]) + (c === '3' && tones.length < 4 ? 12 : 0), at, spb * 1.6, t.arp === 'sine' ? 0.07 : 0.035); }
      if (P.includes('e') && pos % 8 === 4 && (bar + pos) % 3) bell(deg(t, tones[(bar + pos / 4) % tones.length]) + 12, at);
      if (P.includes('d') && t.drums) for (const kd of ['k', 's', 'h']) if (t.drums[kd][pos] === 'x') drum(kd, at, t.soft);
      const ph = P.includes('A') ? t.A : P.includes('B') ? t.B : null;
      if (ph) {
        const line = ph[ci], d = line[posInChord];
        if (d != null) { let len = 1; while (posInChord + len < line.length && line[posInChord + len] == null && len < 4) len++; lead(t.lead, deg(t, d), at, len * spb * 0.95); }
      }
      if (pos % 4 === 0) setTimeout(() => emit('beat', { pos, bar }), Math.max(0, (time - ctx.currentTime) * 1000));
      return true;
    }
    function tick() {
      const t = TRACKS[track], spb = 60 / t.bpm / 4;
      while (nextTime < ctx.currentTime + 0.15) {
        if (!scheduleStep(step, nextTime)) { // track finished: short silence, then the next one
          const wait = (nextTime - ctx.currentTime) * 1000 + 1800;
          clearInterval(timer); timer = null;
          setTimeout(() => {
            if (!playing) return;
            // repeat: 'one' loops this track, 'all' loops the playlist, 'off' stops after the last track
            if (repeat === 'one') { pick(track); startTrack(); }
            else if (repeat === 'off' && !shuffle && track === TRACKS.length - 1) { pick(0); api.pause(); }
            else { pick(shuffle ? randomOther() : (track + 1) % TRACKS.length); startTrack(); }
          }, wait);
          return;
        }
        step++; nextTime += spb;
      }
      emit('progress', progress());
    }
    function randomOther() { if (TRACKS.length < 2) return track; let n; do n = Math.floor(Math.random() * TRACKS.length); while (n === track); return n; }
    function pick(i) { track = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length; step = 0; pausedBar = 0; emit('change', state()); }
    function startTrack(fromBar = 0) {
      clearInterval(timer);
      step = fromBar * 16; nextTime = ctx.currentTime + 0.08; startedAt = ctx.currentTime;
      timer = setInterval(tick, 25); tick();
      updateSession(); emit('change', state());
    }
    function progress() { const t = TRACKS[track]; return { bar: Math.min(t.bars, step / 16), bars: t.bars, seconds: t.seconds, elapsed: Math.min(t.seconds, step / 16 * 4 * 60 / t.bpm) }; }
    function state() { return { playing, track, title: TRACKS[track].title, mood: TRACKS[track].mood, bpm: TRACKS[track].bpm, volume: vol, shuffle, repeat, ...progress() }; }
    function fadeTo(v, secs) { if (!ctx) return; const g = master.gain, now = ctx.currentTime; g.cancelScheduledValues(now); g.setValueAtTime(Math.max(0.0001, g.value), now); g.linearRampToValueAtTime(Math.max(0.0001, v), now + secs); }

    function updateSession() {
      const ms = global.navigator && global.navigator.mediaSession; if (!ms) return;
      try {
        ms.metadata = new global.MediaMetadata({ title: TRACKS[track].title, artist: 'Starcrew radio', album: 'Starcrew Command' });
        ms.playbackState = playing ? 'playing' : 'paused';
      } catch (e) { /* not supported */ }
    }
    if (global.navigator && global.navigator.mediaSession) {
      try {
        const ms = global.navigator.mediaSession;
        ms.setActionHandler('play', () => api.play()); ms.setActionHandler('pause', () => api.pause());
        ms.setActionHandler('nexttrack', () => api.next()); ms.setActionHandler('previoustrack', () => api.prev());
      } catch (e) { /* not supported */ }
    }

    const api = {
      tracks: TRACKS.map((t, i) => ({ index: i, title: t.title, mood: t.mood, bpm: t.bpm, seconds: Math.round(t.seconds) })),
      on(e, f) { (listeners[e] = listeners[e] || []).push(f); },
      state,
      play() {
        init(); if (ctx.state === 'suspended') ctx.resume();
        if (playing) return; playing = true;
        fadeTo(vol, 0.8); startTrack(pausedBar);
      },
      pause() {
        if (!playing) return; playing = false;
        pausedBar = Math.floor(step / 16); fadeTo(0.0001, 0.4);
        setTimeout(() => { if (!playing) { clearInterval(timer); timer = null; } }, 420);
        updateSession(); emit('change', state());
      },
      toggle() { playing ? api.pause() : api.play(); },
      audible() { return !!ctx && ctx.state === 'running'; },
      // Start right away if the browser allows sound without a click; otherwise resolve false
      // so the caller can start on the first click or key press instead.
      async tryAutoplay() {
        try { init(); if (ctx.state === 'suspended') await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 400))]); } catch (e) { return false; }
        if (ctx.state !== 'running') return false;
        api.play(); return true;
      },
      select(i) { pick(i); if (playing) { fadeTo(0.0001, 0.25); setTimeout(() => { fadeTo(vol, 0.6); startTrack(); }, 260); } else api.play(); },
      next() { api.select(shuffle ? randomOther() : track + 1); },
      prev() { if (playing && step / 16 > 2) api.select(track); else api.select(track - 1); },
      setVolume(v) { vol = Math.max(0, Math.min(1, Number(v) || 0)); if (playing) fadeTo(vol, 0.1); emit('change', state()); },
      setShuffle(on) { shuffle = !!on; emit('change', state()); },
      setRepeat(mode) { repeat = ['all', 'one', 'off'].includes(mode) ? mode : 'all'; emit('change', state()); },
      restore(s) { if (!s) return; if (s.volume != null) vol = Math.max(0, Math.min(1, s.volume)); if (s.track != null) track = Math.max(0, Math.min(TRACKS.length - 1, s.track | 0)); shuffle = !!s.shuffle; if (['all', 'one', 'off'].includes(s.repeat)) repeat = s.repeat; },
    };
    return api;
  }
  global.StarRadio = createRadio();
})(window);
