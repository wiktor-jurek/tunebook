// Plays the score drawn on this page, as the website's tune player does (apps/web/src/components/tune-player.tsx and
// lib/playalong-timing.ts): the notes synthesised through an instrument, or a play-along recording that follows the
// score, with the note being played lit up. Driven by the app through window.scorePlayer; it reports its state to the
// app's "player" message handler. Keep it in step with the TypeScript.
(function () {
  var SOUNDFONT = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/";
  // The device's own volume is the volume control; this leaves headroom for chords in the synth.
  var VOLUME = 0.75;
  // The score plays at this many crotchets a minute at 100% (Q:1/4=100 in abcForTune).
  var SCORE_QPM = 100;
  // Play-along timing positions are in 1/48 of a whole note.
  var TIMING_UNIT = 48;

  var context = null;
  var p = { startedAt: 0, offset: 0, playing: false, token: 0 };
  var state = { playing: false, loading: false, counting: false, error: "", progress: 0 };
  var config = { program: 74, speed: 100, track: null, countIn: false, meter: "4/4" };
  var active = [];

  function post() { try { window.webkit.messageHandlers.player.postMessage(state); } catch (e) {} }
  function set(patch) { for (var k in patch) state[k] = patch[k]; post(); }
  function visual() { return window.currentVisual || null; }
  function highlight(elements) {
    active.forEach(function (e) { e.classList.remove("playing-note"); });
    active = elements || [];
    active.forEach(function (e) { e.classList.add("playing-note"); });
  }
  function flat(event) { return event && event.elements ? [].concat.apply([], event.elements) : []; }

  // The beat a player counts in a tune's meter: dotted crotchets in 6/8, 9/8 and 12/8, otherwise the meter's own note.
  function beatOf(meter) {
    var parts = (meter || "4/4").split("/").map(Number), count = parts[0], unit = parts[1];
    if (!count || !unit) return { perBar: 4, crotchets: 1 };
    var compound = unit === 8 && count > 3 && count % 3 === 0;
    return compound ? { perBar: count / 3, crotchets: 1.5 } : { perBar: count, crotchets: 4 / unit };
  }

  // Score position of a play-along recording at ms into it, or null during its lead-in and after the tune ends.
  function scorePosition(timing, ms) {
    var anchors = timing.anchors;
    if (anchors.length < 2 || ms < anchors[0][0] || ms > anchors[anchors.length - 1][0]) return null;
    var i = 1;
    while (anchors[i][0] < ms) i++;
    var from = anchors[i - 1], to = anchors[i];
    var position = from[1] + (to[1] - from[1]) * (ms - from[0]) / (to[0] - from[0]);
    if (position < 0) return null;
    return timing.loop ? position % timing.loop : position;
  }

  function audioContext() {
    context = context || new (window.AudioContext || window.webkitAudioContext)();
    return context.resume().then(function () { return context; });
  }

  // One bar of clicks, the first higher, before the music starts.
  function playCountIn(ctx, beats, beatSeconds) {
    var start = ctx.currentTime + 0.05;
    for (var beat = 0; beat < beats; beat++) {
      var at = start + beat * beatSeconds, tone = ctx.createOscillator(), gain = ctx.createGain();
      tone.frequency.value = beat === 0 ? 1760 : 1320;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.5, at + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      tone.connect(gain).connect(ctx.destination);
      tone.start(at); tone.stop(at + 0.08);
    }
    return new Promise(function (resolve) { setTimeout(resolve, (0.05 + beats * beatSeconds) * 1000); });
  }

  function pause() {
    if (!p.playing) return;
    if (p.audio) p.audio.pause();
    else {
      p.offset = Math.min((p.buffer && p.buffer.duration) || 0, context.currentTime - p.startedAt);
      if (p.source) p.source.stop();
      p.source = undefined;
      if (p.timer) p.timer.pause();
    }
    if (p.raf) cancelAnimationFrame(p.raf);
    p.playing = false;
    set({ playing: false });
  }

  function finished() {
    p.playing = false; p.source = undefined; p.offset = 0;
    if (p.timer) p.timer.stop();
    if (p.raf) cancelAnimationFrame(p.raf);
    highlight([]);
    set({ playing: false, progress: 0 });
  }

  // Share of the way through the current sound, from 0 to 1.
  function position() {
    if (p.audio) return p.audio.duration ? p.audio.currentTime / p.audio.duration : 0;
    return p.buffer ? (p.playing && context ? context.currentTime - p.startedAt : p.offset) / p.buffer.duration : 0;
  }

  // Highlights the note a play-along recording has reached, from its timing.
  function followRecording() {
    var v = visual();
    if (!p.audio || !p.timing || !v) return;
    if (!p.follow) {
      v.setUpAudio({});
      p.follow = new ABCJS.TimingCallbacks(v, {}).noteTimings.filter(function (e) { return e.type === "event"; });
    }
    var pos = scorePosition(p.timing, p.audio.currentTime * 1000), at = -1;
    if (pos !== null && p.follow.length) {
      var ms = pos / TIMING_UNIT / v.getBarLength() * p.follow[0].millisecondsPerMeasure;
      while (at + 1 < p.follow.length && p.follow[at + 1].milliseconds <= ms) at++;
    }
    if (at === p.followAt) return;
    p.followAt = at;
    highlight(flat(p.follow[at]));
  }

  var lastReported = -1;
  function tick() {
    if (!p.playing) return;
    var progress = Math.min(100, Math.round(position() * 100));
    if (progress !== lastReported) { lastReported = progress; set({ progress: progress }); }
    followRecording();
    p.raf = requestAnimationFrame(tick);
  }

  function startRecording(recording, speed, offsetRatio) {
    var token = ++p.token;
    set({ loading: true, error: "" });
    if (!p.audio || p.key !== recording.id) {
      if (p.audio) p.audio.pause();
      var audio = new Audio(recording.url);
      audio.preload = "auto";
      audio.onended = function () { if (p.audio === audio && p.playing) { audio.currentTime = 0; finished(); } };
      p.audio = audio; p.key = recording.id;
    }
    var a = p.audio;
    // Slowed-down practice keeps the recording in tune.
    a.preservesPitch = true;
    a.playbackRate = speed / 100;
    a.volume = VOLUME;
    if (offsetRatio !== undefined) a.currentTime = offsetRatio * recording.durationMs / 1000;
    return a.play().then(function () {
      if (token !== p.token) { a.pause(); return; }
      p.timing = recording.timing; p.followAt = undefined; p.follow = undefined;
      highlight([]);
      p.playing = true; set({ playing: true, loading: false }); tick();
    }).catch(function (cause) { set({ loading: false, error: (cause && cause.message) || "Audio failed" }); });
  }

  function start(offsetRatio) {
    if (config.track) return startRecording(config.track, config.speed, offsetRatio);
    var v = visual();
    if (!v || !ABCJS.synth.supportsAudio()) { set({ error: "Audio is unavailable" }); return Promise.resolve(); }
    var token = ++p.token;
    set({ loading: true, error: "" });
    return audioContext().then(function (ctx) {
      var key = config.program + ":" + config.speed;
      if (p.key === key && p.buffer) return;
      var synth = new ABCJS.synth.CreateSynth();
      return synth.init({ visualObj: v, audioContext: ctx, millisecondsPerMeasure: v.millisecondsPerMeasure() * 100 / config.speed,
        options: { program: config.program, soundFontUrl: SOUNDFONT } }).then(function (result) {
        if (result.error && result.error.length) throw new Error("Some instrument notes could not be loaded");
        return synth.prime();
      }).then(function () {
        if (token !== p.token) return;
        p.buffer = synth.getAudioBuffer(); p.key = key;
        if (!p.buffer) throw new Error("Could not prepare audio");
        if (p.timer) p.timer.stop();
        p.timer = new ABCJS.TimingCallbacks(v, { qpm: v.getBpm() * config.speed / 100, eventCallback: function (event) { highlight(flat(event)); } });
      });
    }).then(function () {
      if (token !== p.token || !p.buffer) return;
      var source = context.createBufferSource(), gain = context.createGain();
      source.buffer = p.buffer; gain.gain.value = VOLUME;
      source.connect(gain).connect(context.destination);
      if (offsetRatio !== undefined) p.offset = Math.min(p.buffer.duration - 0.01, Math.max(0, offsetRatio * p.buffer.duration));
      p.source = source;
      p.startedAt = context.currentTime - p.offset;
      source.onended = function () { if (p.source === source && p.playing) finished(); };
      source.start(0, p.offset);
      p.timer.start(p.offset, "seconds");
      p.playing = true; set({ playing: true, loading: false }); tick();
    }).catch(function (cause) { if (token === p.token) set({ loading: false, error: (cause && cause.message) || "Audio failed" }); });
  }

  function play() {
    if (config.countIn && !config.track) {
      var token = ++p.token, beat = beatOf(config.meter);
      set({ counting: true });
      return audioContext().then(function (ctx) {
        return playCountIn(ctx, beat.perBar, 60 / (SCORE_QPM * config.speed / 100) * beat.crotchets);
      }).then(function () {
        set({ counting: false });
        if (token === p.token) return start();
      });
    }
    return start();
  }

  window.scorePlayer = {
    // A new score: whatever was playing stops, and its sound is prepared afresh.
    reset: function (meter) {
      p.token++;
      if (p.source) p.source.stop();
      if (p.timer) p.timer.stop();
      if (p.audio) p.audio.pause();
      if (p.raf) cancelAnimationFrame(p.raf);
      p.playing = false; p.offset = 0; p.buffer = undefined; p.key = undefined; p.audio = undefined; p.follow = undefined;
      config.meter = meter || "4/4";
      highlight([]);
      set({ playing: false, loading: false, counting: false, error: "", progress: 0 });
    },
    toggle: function () {
      if (state.counting) { p.token++; set({ counting: false }); return; }
      if (state.playing) pause(); else play();
    },
    pause: pause,
    seek: function (value) {
      if (p.audio) { if (p.audio.duration) p.audio.currentTime = value / 100 * p.audio.duration; set({ progress: value }); followRecording(); return; }
      var wasPlaying = p.playing;
      pause();
      p.offset = p.buffer ? value / 100 * p.buffer.duration : 0;
      if (p.timer) p.timer.setProgress(value / 100);
      set({ progress: value });
      if (wasPlaying) start(value / 100);
    },
    setSpeed: function (value) {
      if (p.audio) { config.speed = value; p.audio.playbackRate = value / 100; return; }
      var ratio = position(), wasPlaying = p.playing;
      pause();
      config.speed = value;
      if (wasPlaying) start(ratio);
    },
    // A General MIDI program for the synthesised score, or a play-along recording ({ id, url, durationMs, bpm, timing }).
    setSound: function (program, track) {
      var switching = Boolean(track) !== Boolean(p.audio);
      var ratio = switching ? 0 : position(), wasPlaying = p.playing;
      pause();
      if (!track && p.audio) { p.audio = undefined; p.key = undefined; }
      if (switching) { p.offset = 0; if (p.timer) p.timer.reset(); set({ progress: 0 }); }
      config.program = program; config.track = track || null;
      if (wasPlaying) start(ratio);
    },
    setCountIn: function (on) { config.countIn = on; },
  };
})();
