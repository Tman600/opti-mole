/* OPTI-MOLE - sound.
   Everything is synthesised with Web Audio: no audio files, works offline.

   Menu music: a slow, filtered pad in the spirit of a 2003 DVD menu loop -
   four soft chords, a long room reverb, and the occasional chime.
   Clicks: a rounded pop - a sine that drops in pitch, lowpassed so it never
   snaps. No noise bursts, no square waves, nothing sharp. */

var OptiMoleSound = (function () {
  var ctx = null, master = null, musicBus = null, fxBus = null;
  var padFilter = null, verb = null;

  var prefs = { music: true, fx: true };
  try {
    var saved = JSON.parse(localStorage.getItem("optimole.sound") || localStorage.getItem("silver.sound") || "null");
    if (saved) { prefs.music = saved.music !== false; prefs.fx = saved.fx !== false; }
  } catch (e) {}

  var wantMenu = false, playing = false, timer = null, voices = [], step = 0;
  var tutorialOn = false;    // while the tutorial runs, its song replaces the menu pad
  var hasMusic = true, controlsEl = null;

  var CHORD_SECONDS = 9;
  // D add9, B minor, G major 7, A sus - resolves back into D forever.
  var CHORDS = [
    [50, 57, 62, 64, 69],
    [47, 54, 59, 62, 66],
    [43, 50, 54, 59, 62],
    [45, 52, 57, 62, 64]
  ];

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function save() {
    try { localStorage.setItem("optimole.sound", JSON.stringify(prefs)); } catch (e) {}
  }

  function running() { return ctx && ctx.state === "running"; }

  // ------------------------------------------------------------- graph

  function impulse(seconds, decay) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function ensure() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    var glue = ctx.createDynamicsCompressor();     // nothing ever clips
    glue.threshold.value = -16;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.3;

    master = ctx.createGain();
    master.gain.value = 0.9;
    glue.connect(master);
    master.connect(ctx.destination);

    verb = ctx.createConvolver();
    verb.buffer = impulse(3.4, 2.6);
    var verbOut = ctx.createGain();
    verbOut.gain.value = 0.6;
    verb.connect(verbOut);
    verbOut.connect(glue);

    // the pad breathes: its lowpass cutoff drifts on a very slow LFO
    padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = 950;
    padFilter.Q.value = 0.4;
    var lfo = ctx.createOscillator();
    var lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.045;
    lfoDepth.gain.value = 380;
    lfo.connect(lfoDepth);
    lfoDepth.connect(padFilter.frequency);
    lfo.start();

    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    padFilter.connect(musicBus);
    musicBus.connect(glue);
    musicBus.connect(verb);

    fxBus = ctx.createGain();
    fxBus.gain.value = 1;
    fxBus.connect(glue);
    return true;
  }

  // ------------------------------------------------------------- music

  function chime(freq, when) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.022, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 4.5);
    o.connect(g);
    g.connect(musicBus);
    o.start(when);
    o.stop(when + 4.6);
    return o;
  }

  function playChord() {
    var t = ctx.currentTime + 0.05;
    var notes = CHORDS[step % CHORDS.length];
    step++;

    var env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 3.5);
    env.gain.setValueAtTime(1, t + CHORD_SECONDS - 0.5);
    env.gain.linearRampToValueAtTime(0, t + CHORD_SECONDS + 4.5);   // overlaps the next chord
    env.connect(padFilter);

    var oscs = [];
    notes.forEach(function (m, i) {
      [-7, 7].forEach(function (cents) {
        var o = ctx.createOscillator(), ng = ctx.createGain();
        o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = mtof(m);
        o.detune.value = cents + (Math.random() * 4 - 2);
        ng.gain.value = i === 0 ? 0.065 : 0.026;
        o.connect(ng);
        ng.connect(env);
        o.start(t);
        o.stop(t + CHORD_SECONDS + 5);
        oscs.push(o);
      });
    });

    // one or two chimes somewhere in the chord, two octaves up
    var count = Math.random() < 0.5 ? 1 : 2;
    for (var c = 0; c < count; c++) {
      var pick = notes[1 + Math.floor(Math.random() * (notes.length - 1))] + 24;
      oscs.push(chime(mtof(pick), t + 1 + Math.random() * (CHORD_SECONDS - 3)));
    }

    voices.push(oscs);
    if (voices.length > 4) voices.shift();
  }

  function loop() {
    if (!playing) return;
    playChord();
    timer = setTimeout(loop, CHORD_SECONDS * 1000);
  }

  function startMusic() {
    if (playing || !running()) return;
    playing = true;
    var now = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setValueAtTime(musicBus.gain.value, now);
    musicBus.gain.linearRampToValueAtTime(0.85, now + 4);
    loop();
  }

  function stopMusic() {
    if (!playing) return;
    playing = false;
    clearTimeout(timer);
    var now = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setValueAtTime(musicBus.gain.value, now);
    musicBus.gain.linearRampToValueAtTime(0, now + 1.8);
    var dying = voices;
    voices = [];
    setTimeout(function () {
      dying.forEach(function (set) {
        set.forEach(function (o) { try { o.stop(); } catch (e) {} });
      });
    }, 2000);
  }

  function apply() {
    if (hasMusic && wantMenu && !tutorialOn && prefs.music && running()) startMusic();
    else if (ctx) stopMusic();
    label();
  }

  // ------------------------------------------------------------- clicks

  function pop(kind, force) {
    if ((!prefs.fx && !force) || !ensure()) return;
    if (ctx.state !== "running") ctx.resume();
    var t = ctx.currentTime + 0.005;

    // primary buttons sit a little deeper, destructive ones deeper still
    var base = kind === "deep" ? 380 : kind === "low" ? 290 : 470;
    base *= 0.96 + Math.random() * 0.08;       // never the identical sound twice

    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1700;
    lp.Q.value = 0.5;
    lp.connect(fxBus);

    // the pop: a sine bubble falling in pitch
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(base * 1.7, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.007);    // soft, not instant: no click edge
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g);
    g.connect(lp);
    o.start(t);
    o.stop(t + 0.17);

    // a little rounded body underneath
    var b = ctx.createOscillator(), bg = ctx.createGain();
    b.type = "triangle";
    b.frequency.setValueAtTime(base * 0.8, t);
    b.frequency.exponentialRampToValueAtTime(base * 0.4, t + 0.07);
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.1, t + 0.005);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    b.connect(bg);
    bg.connect(lp);
    b.start(t);
    b.stop(t + 0.12);

    // a whisper of it in the same room as the music
    var send = ctx.createGain();
    send.gain.value = 0.1;
    lp.connect(send);
    send.connect(verb);
  }

  // ------------------------------------------------------------- tutorial sound effects
  // All synthesised. Kept soft and rounded like the button pop: lowpassed, no
  // hard edges, nothing that snaps. The tutorial has its own sound toggle, so
  // these ignore the "clicks" setting.

  var noiseBuffer = null;
  function noise() {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      var d = noiseBuffer.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    return src;
  }

  function fxReady() {
    if (!ensure()) return false;
    if (ctx.state !== "running") ctx.resume();
    return true;
  }

  function env(g, t, peak, attack, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  function lowpass(freq) {
    var f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    f.Q.value = 0.5;
    return f;
  }

  function send(node, amount) {
    var s = ctx.createGain();
    s.gain.value = amount;
    node.connect(s);
    s.connect(verb);
  }

  var sfx = {
    // air moving past: filtered noise that sweeps up and back down
    whoosh: function (dur) {
      if (!fxReady()) return;
      dur = dur || 0.6;
      var t = ctx.currentTime + 0.01, n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = "bandpass";
      bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(320, t);
      bp.frequency.exponentialRampToValueAtTime(2000, t + dur * 0.45);
      bp.frequency.exponentialRampToValueAtTime(450, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(bp); bp.connect(g); g.connect(fxBus); send(g, 0.2);
      n.start(t); n.stop(t + dur + 0.05);
    },

    // the drive tray motor, then a soft thunk when it stops
    tray: function (closing) {
      if (!fxReady()) return;
      var t = ctx.currentTime + 0.01, dur = 0.7;
      var m = ctx.createOscillator(), mg = ctx.createGain(), lp = lowpass(240);
      m.type = "sawtooth";
      m.frequency.setValueAtTime(closing ? 72 : 52, t);
      m.frequency.linearRampToValueAtTime(closing ? 50 : 70, t + dur);
      mg.gain.setValueAtTime(0.0001, t);
      mg.gain.exponentialRampToValueAtTime(0.09, t + 0.08);
      mg.gain.setValueAtTime(0.09, t + dur - 0.1);
      mg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      m.connect(lp); lp.connect(mg); mg.connect(fxBus);
      m.start(t); m.stop(t + dur + 0.05);

      var n = noise(), ng = ctx.createGain(), nlp = lowpass(900);
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.025, t + 0.1);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(nlp); nlp.connect(ng); ng.connect(fxBus);
      n.start(t); n.stop(t + dur + 0.05);

      sfx.thunk(t + dur);
    },

    thunk: function (when) {
      if (!fxReady()) return;
      var t = when || ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(80, t + 0.1);
      env(g, t, 0.22, 0.004, 0.14);
      o.connect(g); g.connect(fxBus);
      o.start(t); o.stop(t + 0.2);
    },

    // the disc spinning up: a low tone rising, with a little air on top
    spin: function () {
      if (!fxReady()) return;
      var t = ctx.currentTime + 0.01, dur = 1.9, lp = lowpass(1100), g = ctx.createGain();
      var o = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o.type = "sine"; o2.type = "triangle";
      o.frequency.setValueAtTime(45, t);
      o.frequency.exponentialRampToValueAtTime(230, t + dur * 0.8);
      o2.frequency.setValueAtTime(90, t);
      o2.frequency.exponentialRampToValueAtTime(460, t + dur * 0.8);
      g2.gain.value = 0.3;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.5);
      g.gain.setValueAtTime(0.07, t + dur - 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(fxBus);
      o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    },

    // a key being typed: tiny and soft
    tick: function () {
      if (!fxReady()) return;
      var t = ctx.currentTime + 0.005, o = ctx.createOscillator(), g = ctx.createGain(), lp = lowpass(2600);
      o.type = "sine";
      o.frequency.value = 1350 + Math.random() * 120;
      env(g, t, 0.07, 0.002, 0.035);
      o.connect(lp); lp.connect(g); g.connect(fxBus);
      o.start(t); o.stop(t + 0.06);
    },

    // a camera shutter, rounded off
    shutter: function () {
      if (!fxReady()) return;
      [0, 0.085].forEach(function (off, i) {
        var t = ctx.currentTime + 0.01 + off, n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
        bp.type = "bandpass"; bp.frequency.value = i ? 1800 : 2600; bp.Q.value = 0.9;
        env(g, t, i ? 0.14 : 0.2, 0.002, 0.05);
        n.connect(bp); bp.connect(g); g.connect(fxBus);
        n.start(t); n.stop(t + 0.08);
      });
    },

    // a bell tone; midi note number
    chime: function (midi) {
      if (!fxReady()) return;
      var t = ctx.currentTime + 0.01, f = mtof(midi || 76);
      [[1, 0.12], [2, 0.03]].forEach(function (h) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.value = f * h[0];
        env(g, t, h[1], 0.01, 1.6);
        o.connect(g); g.connect(fxBus); send(g, 0.35);
        o.start(t); o.stop(t + 1.7);
      });
    },

    // the Mole: two low notes a minor third apart, slow and a little ominous
    sting: function () {
      if (!fxReady()) return;
      [[50, 0], [53, 0.18]].forEach(function (n) {
        var t = ctx.currentTime + 0.01 + n[1], o = ctx.createOscillator(), g = ctx.createGain(), lp = lowpass(700);
        o.type = "triangle"; o.frequency.value = mtof(n[0]);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.18);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
        o.connect(lp); lp.connect(g); g.connect(fxBus); send(g, 0.4);
        o.start(t); o.stop(t + 2.5);
      });
    },

    // a rubber stamp landing
    stamp: function () {
      if (!fxReady()) return;
      var t = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
      env(g, t, 0.32, 0.003, 0.22);
      o.connect(g); g.connect(fxBus);
      o.start(t); o.stop(t + 0.3);
      var n = noise(), ng = ctx.createGain(), lp = lowpass(650);
      env(ng, t, 0.12, 0.002, 0.08);
      n.connect(lp); lp.connect(ng); ng.connect(fxBus);
      n.start(t); n.stop(t + 0.12);
    },

    // points going up: two quick bright-but-soft notes
    coin: function () {
      if (!fxReady()) return;
      [[79, 0], [84, 0.09]].forEach(function (n) {
        var t = ctx.currentTime + 0.01 + n[1], o = ctx.createOscillator(), g = ctx.createGain(), lp = lowpass(3000);
        o.type = "triangle"; o.frequency.value = mtof(n[0]);
        env(g, t, 0.09, 0.004, 0.35);
        o.connect(lp); lp.connect(g); g.connect(fxBus);
        o.start(t); o.stop(t + 0.45);
      });
    },

    pop: function (kind) { pop(kind || "", true); }
  };

  // ------------------------------------------------------------- tutorial song
  // Poppy but minimal: 112 bpm, the menu's D - Bm - G - A turned into a
  // I-vi-IV-V pop loop. Soft kick, soft clap, a plucky bass, one bright
  // arpeggio, and a quiet shaker on alternate passes. Everything lowpassed and
  // rounded like the rest of the game - nothing sharp.

  var SONG_BPM = 112;
  var SONG_CHORDS = [          // root (bass octave), then chord tones for the arpeggio
    { root: 38, tones: [62, 66, 69, 74] },     // D
    { root: 35, tones: [59, 62, 66, 71] },     // Bm
    { root: 31, tones: [55, 59, 62, 67] },     // G
    { root: 33, tones: [57, 61, 64, 69] }      // A
  ];
  var ARP = [0, 1, 2, 3, 2, 1, 2, 3];          // which chord tone on each eighth note
  var ARP_B = [0, 2, 1, 3, 0, 3, 2, 1];        // a second shape, so it doesn't loop stiffly
  var BASS = [1, 0, 1, 1, 0, 1, 0, 1];          // eighths where the bass plucks

  var songBus = null, songTimer = null, songOn = false, songNext = 0, songStep = 0;
  var SONG_LEVEL = 0.55, SONG_DUCKED = 0.2;

  function songNote(midi, when, type, peak, decay, cutoff, wet) {
    var o = ctx.createOscillator(), g = ctx.createGain(), lp = lowpass(cutoff);
    o.type = type;
    o.frequency.value = mtof(midi);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    o.connect(lp); lp.connect(g); g.connect(songBus);
    if (wet) send(g, wet);
    o.start(when); o.stop(when + decay + 0.05);
  }

  function songKick(when) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(110, when);
    o.frequency.exponentialRampToValueAtTime(45, when + 0.14);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.5, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);
    o.connect(g); g.connect(songBus);
    o.start(when); o.stop(when + 0.32);
  }

  function songNoise(when, freq, q, peak, decay, wet) {
    var n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    n.connect(bp); bp.connect(g); g.connect(songBus);
    if (wet) send(g, wet);
    // start at a random point in the noise so no two hits are identical
    n.start(when, Math.random() * 1.5); n.stop(when + decay + 0.05);
  }

  function scheduleEighth(k, when) {
    var eighth = k % 8, bar = Math.floor(k / 8), chord = SONG_CHORDS[bar % 4];
    var pass = Math.floor(bar / 4);            // one pass = 4 bars
    var alt = pass % 2 === 1;

    if (eighth === 0 || eighth === 4 || eighth === 7) songKick(when);          // 1, 3 and the "and" of 4
    if (eighth === 2 || eighth === 6) songNoise(when, 1400, 0.9, 0.16, 0.14, 0.25);  // soft clap on 2 and 4
    if (alt && eighth % 2 === 1) songNoise(when, 4200, 1.2, 0.035, 0.05);   // shaker, second pass only

    if (BASS[eighth]) songNote(chord.root + (eighth === 5 ? 12 : 0), when, "triangle", 0.26, 0.2, 700);

    var shape = alt ? ARP_B : ARP;
    songNote(chord.tones[shape[eighth]] + 12, when, "sine", 0.07, 0.32, 2600, 0.3);
    if (eighth === 0) songNote(chord.tones[0] + 24, when, "triangle", 0.03, 0.9, 3000, 0.45);  // a little sparkle each bar
  }

  function songTick() {
    if (!songOn) return;
    var eighthSec = 60 / SONG_BPM / 2;
    // schedule a little ahead of the clock, the standard Web Audio way
    while (songNext < ctx.currentTime + 0.15) {
      scheduleEighth(songStep, songNext);
      songStep++;
      songNext += eighthSec;
    }
  }

  var song = {
    start: function () {
      tutorialOn = true;
      apply();                                  // fades the menu pad out
      if (!prefs.music || songOn || !fxReady()) return;
      if (!songBus) {
        songBus = ctx.createGain();
        songBus.gain.value = 0;
        songBus.connect(fxBus);                 // through the same glue compressor, so it can't clip
      }
      songOn = true;
      songStep = 0;
      songNext = ctx.currentTime + 0.1;
      var now = ctx.currentTime;
      songBus.gain.cancelScheduledValues(now);
      songBus.gain.setValueAtTime(0.0001, now);
      songBus.gain.linearRampToValueAtTime(SONG_LEVEL, now + 1.5);
      songTimer = setInterval(songTick, 25);
      songTick();
    },
    stop: function () {
      tutorialOn = false;
      if (songOn) {
        songOn = false;
        clearInterval(songTimer);
        var now = ctx.currentTime;
        songBus.gain.cancelScheduledValues(now);
        songBus.gain.setValueAtTime(songBus.gain.value, now);
        songBus.gain.linearRampToValueAtTime(0, now + 0.9);
      }
      apply();                                  // menu pad comes back on the home screen
    }
  };

  // pull the music down while the narrator speaks - the tutorial song if it's
  // playing, otherwise the menu pad
  function duck(on) {
    if (!ctx) return;
    var now = ctx.currentTime;
    if (songOn) {
      songBus.gain.cancelScheduledValues(now);
      songBus.gain.setValueAtTime(songBus.gain.value, now);
      songBus.gain.linearRampToValueAtTime(on ? SONG_DUCKED : SONG_LEVEL, now + 0.4);
      return;
    }
    if (!playing) return;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setValueAtTime(musicBus.gain.value, now);
    musicBus.gain.linearRampToValueAtTime(on ? 0.28 : 0.85, now + 0.5);
  }

  // ------------------------------------------------------------- controls

  function label() {
    if (!controlsEl) return;
    var m = controlsEl.querySelector("[data-k=music]");
    var f = controlsEl.querySelector("[data-k=fx]");
    if (m) {
      m.textContent = !prefs.music ? "music off"
        : running() ? "music on" : "music · click to start";
      m.style.color = prefs.music ? "#d8a13a" : "#7d838c";
    }
    if (f) {
      f.textContent = prefs.fx ? "clicks on" : "clicks off";
      f.style.color = prefs.fx ? "#d8a13a" : "#7d838c";
    }
  }

  function controls(opts) {
    hasMusic = !opts || opts.music !== false;
    var wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;right:14px;bottom:12px;z-index:60;display:flex;gap:8px;";
    var style = "display:inline-block;width:auto;margin:0;padding:6px 10px;" +
      "font-family:inherit;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;" +
      "background:rgba(10,12,15,0.85);border:1px solid #2c3138;cursor:pointer;";
    var keys = hasMusic ? ["music", "fx"] : ["fx"];
    keys.forEach(function (k) {
      var btn = document.createElement("button");
      btn.setAttribute("data-k", k);
      btn.setAttribute("data-silent", "1");
      btn.style.cssText = style;
      btn.addEventListener("click", function () {
        // If sound has not been unlocked yet, this click is the unlock -
        // do not also flip the setting the person was trying to hear.
        if (k === "music" && prefs.music && !running()) { unlock(); return; }
        prefs[k] = !prefs[k];
        save();
        if (k === "fx" && prefs.fx) pop("");
        apply();
      });
      wrap.appendChild(btn);
    });
    document.body.appendChild(wrap);
    controlsEl = wrap;
    label();
  }

  // ------------------------------------------------------------- wiring

  // Browsers refuse to play audio until the page has been touched.
  function unlock() {
    if (!ensure()) return;
    var p = ctx.state === "running" ? null : ctx.resume();
    if (p && p.then) p.then(apply); else apply();
  }

  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);

  // Every real button pops. Capture phase, because the handler on the
  // button often rebuilds the screen and the button is gone a moment later.
  document.addEventListener("click", function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest("button") : null;
    if (!b || b.disabled || b.getAttribute("data-silent")) return;
    pop(b.classList.contains("bad") ? "low" : b.classList.contains("primary") ? "deep" : "");
  }, true);

  return {
    menu: function (on) {
      if (on === wantMenu) return;
      wantMenu = on;
      apply();
    },
    pop: pop,
    sfx: sfx,
    song: song,
    duck: duck,
    unlock: unlock,
    controls: controls,
    _debug: function () {
      return {
        state: ctx ? ctx.state : "none", playing: playing, wantMenu: wantMenu,
        song: songOn, songGain: songBus ? +songBus.gain.value.toFixed(3) : null,
        prefs: prefs, musicGain: musicBus ? musicBus.gain.value : null
      };
    },
    // peak level coming out of the mix, 0..1, sampled over `ms` - for testing
    _meter: function (ms) {
      if (!ctx) return Promise.resolve(null);
      var an = ctx.createAnalyser();
      an.fftSize = 2048;
      master.connect(an);
      var buf = new Float32Array(an.fftSize), peak = 0, sum = 0, n = 0;
      return new Promise(function (done) {
        var end = Date.now() + ms;
        (function sample() {
          an.getFloatTimeDomainData(buf);
          for (var i = 0; i < buf.length; i++) {
            var v = Math.abs(buf[i]);
            if (v > peak) peak = v;
            sum += buf[i] * buf[i]; n++;
          }
          if (Date.now() < end) setTimeout(sample, 20);
          else { master.disconnect(an); done({ peak: peak, rms: Math.sqrt(sum / n) }); }
        })();
      });
    }
  };
})();
