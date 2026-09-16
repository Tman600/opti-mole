/* OPTI-MOLE - the animated tutorial.

   Press the button once and it plays start to finish on its own: each scene
   draws itself, plays its sound effects, and the computer's own voice reads the
   caption. When the voice finishes (and the animation has), it moves on.

   Scenes are HTML shapes and sounds are synthesised in sound.js. Narration is
   the recorded voice in web/narration/01.mp3 .. 12.mp3, one clip per scene;
   any clip that's missing or won't play falls back to the browser's built-in
   speech reading the caption. Works offline. */

var OptiMoleTutorial = (function () {
  var W = 1280, H = 720;
  var root, viewport, frame, caption, progress, playBtn, skipBtn;
  var S = {
    i: 0, playing: false, t: 0, last: 0, raf: 0, steps: [],
    animEnd: 0, speechDone: true, speechEndT: 0, fallbackT: 0, ended: false
  };

  // No voice/sound toggles any more, so both are simply on. (An old saved
  // "voice off" from when there were toggles must not silence it for good.)
  var prefs = { voice: true, sound: true };

  // ------------------------------------------------------------- drawing kit

  function mk(cls, x, y, html, parent, extra) {
    var n = document.createElement("div");
    n.className = cls;
    if (x !== null && x !== undefined) n.style.left = x + "px";
    if (y !== null && y !== undefined) n.style.top = y + "px";
    if (html) n.innerHTML = html;
    if (extra) for (var k in extra) n.style[k] = extra[k];
    (parent || frame).appendChild(n);
    return n;
  }

  // animate to new styles; the reflow makes a freshly-made element animate too
  function glide(n, css, ms, ease) {
    n.style.transition = "all " + (ms || 700) + "ms " + (ease || "cubic-bezier(.2,.75,.25,1)");
    void n.offsetWidth;
    for (var k in css) n.style[k] = css[k];
  }

  function show(n, ms) { glide(n, { opacity: 1 }, ms || 500); }

  function at(ms, fn) { S.steps.push({ t: ms, fn: fn, done: false }); }

  function sfx(name, arg) {
    if (!prefs.sound || !window.OptiMoleSound || !OptiMoleSound.sfx) return;
    var f = OptiMoleSound.sfx[name];
    if (f) f(arg);
  }

  function title(text) { return mk("t-title", null, null, esc(text)); }

  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function disc(x, y, size, opts) {
    opts = opts || {};
    var n = mk("t-disc t-c" + (opts.special ? " special" : "") + (opts.spin ? " spinning" : ""),
      x, y, '<div class="face"></div>' + (opts.scratch ? '<div class="scratch"></div>' : ""),
      opts.parent, { width: size + "px", height: size + "px", opacity: opts.hidden ? 0 : 1 });
    return n;
  }

  function fig(x, y, kind, parent) {
    return mk("t-fig t-c " + kind, x, y, '<div class="head"></div><div class="torso"></div>', parent);
  }

  function drive(x, y) {
    var d = mk("t-drive", x, y,
      '<div class="body"><div class="slot"></div><div class="badge">DVD</div><div class="led"></div></div>' +
      '<div class="tray"><div class="well"></div></div>');
    return { node: d, tray: d.querySelector(".tray"), led: d.querySelector(".led") };
  }

  function card(x, y, w, html, cls) {
    return mk("t-card t-c " + (cls || ""), x, y, html, null, { width: w + "px", opacity: 0 });
  }

  function countdown(node, from, to, t0, stepMs) {
    for (var k = 0; k <= from - to; k++) {
      (function (v, when) {
        at(when, function () {
          node.textContent = Math.floor(v / 60) + ":" + (v % 60 < 10 ? "0" : "") + (v % 60);
        });
      })(from - k, t0 + k * stepMs);
    }
  }

  function arrow(d, cls) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "t-svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    if (cls) p.setAttribute("class", cls);
    svg.appendChild(p);
    frame.appendChild(svg);
    var len = p.getTotalLength();
    p.style.strokeDasharray = "10 8";
    p.style.opacity = "0";
    return {
      draw: function (ms) {
        // reveal the dashed line along its length with a mask-like dash trick
        p.style.opacity = "1";
        p.style.strokeDasharray = len + " " + len;
        p.style.strokeDashoffset = len;
        void p.getBoundingClientRect();
        p.style.transition = "stroke-dashoffset " + (ms || 900) + "ms ease-out";
        p.style.strokeDashoffset = "0";
      }
    };
  }

  function photo(x, y, kind) {
    var n = mk("t-photo t-c", x, y, "", null, { opacity: 0 });
    var shapes = {
      lamp: '<i style="left:95px;top:30px;width:30px;height:80px;background:#8e949c"></i>' +
            '<i style="left:65px;top:16px;width:90px;height:34px;background:#d8a13a;border-radius:40px 40px 4px 4px"></i>',
      clock: '<i style="left:70px;top:22px;width:84px;height:84px;border-radius:50%;background:#d6d9dd"></i>' +
             '<i style="left:110px;top:34px;width:4px;height:34px;background:#07080a"></i>' +
             '<i style="left:110px;top:64px;width:26px;height:4px;background:#07080a"></i>',
      shoe: '<i style="left:40px;top:70px;width:140px;height:40px;background:#a8744b;border-radius:10px 60px 8px 8px"></i>',
      tower: '<i style="left:85px;top:84px;width:50px;height:26px;background:#9fb7c9"></i>' +
             '<i style="left:95px;top:58px;width:30px;height:26px;background:#c9a79f"></i>' +
             '<i style="left:100px;top:30px;width:20px;height:28px;background:#d8a13a"></i>',
      blur: '<i style="left:20px;top:20px;width:170px;height:90px;background:#3a4048;filter:blur(8px)"></i>'
    };
    n.innerHTML = shapes[kind] || shapes.blur;
    return n;
  }

  // ------------------------------------------------------------- the scenes

  var SCENES = [

    { // 1 ---------------------------------------------------------------- title
      say: "Welcome to Opti-Mole. Two teams, one drive, and somebody in the room who is not on your side.",
      build: function () {
        var logo = mk("t-logo t-c", 640, 290, '<span class="opti">OPTI-</span><span class="mole">MOLE</span>',
          null, { opacity: 0, transform: "translate(-50%,-50%) scale(0.86)" });
        var d = disc(-140, 490, 130, { spin: true });
        var sub = mk("t-sub t-c", 640, 610, "a party game for a dvd drive", null, { opacity: 0 });
        at(200, function () { sfx("whoosh", 0.9); glide(logo, { opacity: 1, transform: "translate(-50%,-50%) scale(1)" }, 1500); });
        at(1100, function () { sfx("whoosh", 1.2); glide(d, { left: "640px" }, 1700); });
        at(2800, function () { d.classList.remove("spinning"); sfx("chime", 74); show(sub, 900); });
      }
    },

    { // 2 ---------------------------------------------------------------- discs
      say: "Any DVDs with something on them will do. Put each one in the tray once, and the game remembers it forever. It never plays them. It only reads them.",
      build: function () {
        title("1 · the discs");
        var dr = drive(250, 300);
        var d = disc(1080, 160, 90, {});
        var reg = card(1000, 520, 360,
          '<div class="k">registered</div><div class="big" id="t-reg"></div><div class="dim" id="t-reg2"></div>');
        at(400, function () { sfx("tray", false); glide(dr.tray, { transform: "translateX(260px)" }, 800); });
        at(1300, function () { sfx("whoosh"); glide(d, { left: (250 + 30 + 140 + 260) + "px", top: (300 + 18 + 47) + "px" }, 1100); });
        at(2500, function () {
          // the disc drops into the tray, so it rides back in with it
          d.style.transition = "none";
          d.style.left = "140px"; d.style.top = "47px";
          dr.tray.appendChild(d);
          sfx("thunk");
        });
        at(2900, function () { sfx("tray", true); glide(dr.tray, { transform: "translateX(0)" }, 800); });
        at(3800, function () { dr.led.classList.add("on"); sfx("spin"); });
        at(4600, function () { show(reg); });
        var name = "SHREK 2";
        for (var k = 1; k <= name.length; k++) {
          (function (n) {
            at(4700 + n * 90, function () { el("t-reg").textContent = name.slice(0, n); if (name[n - 1] !== " ") sfx("tick"); });
          })(k);
        }
        at(5700, function () { el("t-reg2").textContent = "fingerprinted · remembered forever"; dr.led.classList.remove("on"); sfx("chime", 79); });
      }
    },

    { // 3 ---------------------------------------------------------------- teams and moles
      say: "Split into Team A and Team B. One player on each team is secretly a Mole. They play for your team all night, but they only win if the other team wins.",
      build: function () {
        title("2 · teams, and the mole");
        var la = mk("t-label a t-c", 330, 250, "team a", null, { opacity: 0 });
        var lb = mk("t-label b t-c", 950, 250, "team b", null, { opacity: 0 });
        var A = [230, 330, 430].map(function (x) { return fig(x, 400, "a"); });
        var B = [850, 950, 1050].map(function (x) { return fig(x, 400, "b"); });
        A.concat(B).forEach(function (f) { f.style.opacity = 0; f.style.transform = "translate(-50%,-50%) scale(0.2)"; });
        at(200, function () { show(la); show(lb); });
        A.concat(B).forEach(function (f, i) {
          at(500 + i * 170, function () {
            sfx("pop");
            glide(f, { opacity: 1, transform: "translate(-50%,-50%) scale(1)" }, 420, "cubic-bezier(.3,1.6,.5,1)");
          });
        });
        at(2300, function () {
          sfx("sting");
          [A[2], B[0]].forEach(function (f) {
            f.classList.remove("a", "b"); f.classList.add("mole");
            mk("tag", null, null, "MOLE", f);
          });
        });
        var a1 = arrow("M 430 460 C 520 600, 760 600, 850 470");
        var a2 = arrow("M 850 340 C 760 200, 520 200, 430 330");
        at(3300, function () { a1.draw(1000); });
        at(3900, function () { a2.draw(1000); });
        var note = mk("t-sub t-c", 640, 640, "secretly playing for the other side", null, { opacity: 0 });
        at(4600, function () { show(note, 800); });
      }
    },

    { // 4 ---------------------------------------------------------------- the host
      say: "A host is optional. The host does not play. They hide the three special discs, choose which powers are live, and can give three minor clues and two big clues, out loud, all game.",
      build: function () {
        title("3 · the host (optional)");
        var host = fig(220, 330, "host");
        host.style.opacity = 0;
        mk("t-label amber t-c", 220, 410, "host");
        var rooms = [
          [640, 150, 260, 190, "kitchen"], [900, 150, 300, 190, "living room"],
          [640, 340, 200, 200, "hall"], [840, 340, 360, 200, "bedroom"]
        ].map(function (r) {
          return mk("t-room", r[0], r[1], "<span>" + r[4] + "</span>", null, { width: r[2] + "px", height: r[3] + "px", opacity: 0 });
        });
        var targets = [[760, 250], [1110, 220], [1060, 470]];
        var discs = targets.map(function () { return disc(260, 330, 58, { special: true, hidden: true }); });
        var clues = card(360, 590, 540,
          '<div class="k">host clues &middot; out loud &middot; all game</div>' +
          '<div class="t-dots">minor <b>●</b><b>●</b><b>●</b> &nbsp; big <b>●</b><b>●</b></div>');
        at(200, function () { show(host); rooms.forEach(function (r, i) { show(r, 600 + i * 150); }); });
        targets.forEach(function (p, i) {
          at(1300 + i * 900, function () {
            discs[i].style.opacity = 1;
            sfx("whoosh", 0.7);
            glide(discs[i], { left: p[0] + "px", top: p[1] + "px" }, 800);
          });
          at(2150 + i * 900, function () { sfx("thunk"); });
        });
        at(4300, function () { show(clues); });
        [0, 1, 2, 3, 4].forEach(function (k) {
          at(4800 + k * 320, function () { clues.querySelectorAll("b")[k].className = "lit"; sfx("tick"); });
        });
      }
    },

    { // 5 ---------------------------------------------------------------- hiding, roles, codes
      say: "The laptop goes around the room twice. First everyone privately learns where to hide their discs. Then everyone learns their team, their role, and their team code. Keep your code secret.",
      build: function () {
        title("4 · hiding, roles and codes");
        var cx = 400, cy = 390, r = 190, pts = [];
        for (var k = 0; k < 6; k++) {
          var ang = -Math.PI / 2 + k * Math.PI / 3;
          pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
          var f = fig(pts[k][0], pts[k][1], "plain");
          f.style.opacity = 0;
          (function (f, k) { at(150 + k * 90, function () { show(f); }); })(f, k);
        }
        var lap = mk("t-laptop t-c", cx, cy, '<div class="lid"></div><div class="base"></div>', null, { opacity: 0 });
        at(800, function () { show(lap); });
        for (var h = 0; h < 12; h++) {
          (function (h) {
            var p = pts[h % 6];
            at(1300 + h * 330, function () {
              if (h % 3 === 0) sfx("whoosh", 0.4);
              glide(lap, { left: (cx + (p[0] - cx) * 0.62) + "px", top: (cy + (p[1] - cy) * 0.62) + "px" }, 300);
            });
          })(h);
        }
        var ph = mk("t-phone t-c", 1000, 390, '<div class="screen"><div class="t-label a">team a</div>' +
          '<div class="t-card" style="position:static;border:none;background:none;padding:0">' +
          '<div class="code" id="t-code"></div></div><div class="t-label">keep it secret</div></div>',
          null, { opacity: 0 });
        at(5400, function () { sfx("whoosh"); show(ph, 600); });
        "4821".split("").forEach(function (dgt, i) {
          at(6100 + i * 280, function () { el("t-code").textContent += dgt; sfx("tick"); });
        });
      }
    },

    { // 6 ---------------------------------------------------------------- one turn
      say: "When the clock starts, find a disc and bring it to the tray. Claim it with your team code, and you get a task on a timer. Do it, take a photo on your phone, and log it. Nothing is judged yet.",
      build: function () {
        title("5 · a turn");
        mk("t-room", 60, 170, "<span>somewhere cold</span>", null, { width: "260px", height: "190px" });
        var d = disc(190, 275, 70, {});
        var dr = drive(390, 470);
        var codeBox = card(560, 400, 300, '<div class="k">claim with your code</div><div class="code" id="t-claim"></div>');
        var task = card(990, 260, 420,
          '<div class="k">team a &middot; vote</div><div class="big">Bring back the ugliest object in this house.</div>' +
          '<div class="clock" id="t-clock">2:00</div>');
        var ph = mk("t-phone t-c", 1070, 560, '<div class="screen" id="t-ph"><div class="t-label">phone</div></div><div class="flash"></div>',
          null, { opacity: 0, transform: "translate(-50%,-50%) scale(0.62)" });
        at(300, function () { d.classList.add("spinning"); sfx("chime", 81); });
        at(1100, function () { sfx("tray", false); glide(dr.tray, { transform: "translateX(260px)" }, 700); });
        at(1500, function () {
          d.classList.remove("spinning"); sfx("whoosh");
          glide(d, { left: (390 + 30 + 140 + 260) + "px", top: (470 + 18 + 47) + "px" }, 900);
        });
        at(2450, function () {
          d.style.transition = "none"; d.style.left = "140px"; d.style.top = "47px";
          dr.tray.appendChild(d); sfx("thunk");
        });
        at(2700, function () { sfx("tray", true); glide(dr.tray, { transform: "translateX(0)" }, 700); });
        at(3450, function () { dr.led.classList.add("on"); sfx("spin"); show(codeBox); });
        "4821".split("").forEach(function (dgt, i) {
          at(3900 + i * 260, function () { el("t-claim").textContent += dgt; sfx("tick"); });
        });
        at(5000, function () {
          dr.led.classList.remove("on"); sfx("chime", 76);
          el("t-claim").textContent = "TEAM A"; el("t-claim").style.fontSize = "34px";
          show(task);
        });
        countdown(el("t-clock"), 120, 96, 5500, 110);
        at(7000, function () { show(ph); });
        at(8000, function () {
          sfx("shutter");
          var fl = ph.querySelector(".flash");
          fl.style.opacity = 0.9;
          glide(fl, { opacity: 0 }, 600);
          var scr = el("t-ph");
          scr.innerHTML = "";
          var pic = photo(0, 0, "lamp");
          scr.appendChild(pic);
          pic.style.position = "relative"; pic.style.left = "auto"; pic.style.top = "auto";
          pic.style.transform = "scale(0.62)"; pic.style.opacity = 1;
        });
        at(8900, function () {
          var st = mk("t-stamp amber t-c", 990, 250, "LOGGED", null, { opacity: 0, transform: "translate(-50%,-50%) rotate(-8deg) scale(1.6)" });
          sfx("stamp");
          glide(st, { opacity: 1, transform: "translate(-50%,-50%) rotate(-8deg) scale(1)" }, 220, "ease-in");
        });
      }
    },

    { // 7 ---------------------------------------------------------------- both teams
      say: "Both teams can run a task at the same time. But each team only gets one task at a time.",
      build: function () {
        title("6 · both teams at once");
        var ta = card(360, 330, 440, '<div class="k" style="color:#9fb7c9">team a</div><div class="big">Photograph your whole team fitting inside one doorway.</div><div class="clock" id="t-ca">1:30</div>');
        var tb = card(920, 330, 440, '<div class="k" style="color:#c9a79f">team b</div><div class="big">Bring back three objects that are the same colour.</div><div class="clock" id="t-cb">2:00</div>');
        at(200, function () { sfx("whoosh"); show(ta); });
        at(700, function () { sfx("whoosh"); show(tb); });
        countdown(el("t-ca"), 90, 72, 1200, 150);
        countdown(el("t-cb"), 120, 102, 1200, 150);
        var d = disc(360, 780, 70, {});
        at(3100, function () { sfx("whoosh", 0.5); glide(d, { top: "520px" }, 500, "ease-out"); });
        at(3600, function () {
          sfx("thunk");
          glide(d, { top: "790px" }, 700, "ease-in");
          var no = mk("t-stamp no t-c", 360, 560, "ONE TASK PER TEAM", null, { opacity: 0, fontSize: "22px" });
          sfx("stamp");
          show(no, 200);
        });
      }
    },

    { // 8 ---------------------------------------------------------------- special discs
      say: "Three discs each game are special, and each one carries a power. There are seven powers in all. Most are saved for the end of the game, but two are used during play.",
      build: function () {
        title("7 · special discs");
        var names = [["CONFESSION", "end"], ["VETO", "end"], ["TESTIMONY", "end"], ["SHIELD", "end"],
                     ["LONG COUNT", "end"], ["HIJACK", "play"], ["SCRATCH", "play"]];
        var live = ["VETO", "HIJACK", "SCRATCH"];
        var cards = names.map(function (n) {
          return mk("t-power t-c", 640, 380,
            '<div class="n">' + n[0] + '</div><div class="w">' + (n[1] === "play" ? "during play" : "end of game") + '</div>',
            null, { opacity: 0 });
        });
        at(300, function () { cards.forEach(function (c) { c.style.opacity = 1; }); sfx("whoosh", 1.0); });
        cards.forEach(function (c, i) {
          at(500 + i * 90, function () { glide(c, { left: (190 + i * 150) + "px" }, 800); });
        });
        at(2300, function () {
          cards.forEach(function (c, i) {
            if (live.indexOf(names[i][0]) === -1) glide(c, { opacity: 0.25 }, 600);
          });
        });
        live.forEach(function (name, k) {
          var i = names.map(function (n) { return n[0]; }).indexOf(name);
          at(2800 + k * 500, function () {
            cards[i].classList.add("live");
            sfx("chime", [76, 79, 83][k]);
            glide(cards[i], { top: "340px" }, 500, "cubic-bezier(.3,1.5,.5,1)");
          });
        });
        var note = mk("t-sub t-c", 640, 560, "three are live each game · the host or the computer picks", null, { opacity: 0 });
        at(4600, function () { show(note, 800); });
      }
    },

    { // 9 ---------------------------------------------------------------- hijack and scratch
      say: "Hijack lets your team join the other team's running task, and the first photo the room accepts wins. Scratch makes the other team's next disc load for forty five seconds before they can even see their task.",
      build: function () {
        title("8 · the play powers");
        mk("t-label amber t-c", 320, 130, "hijack");
        mk("t-label amber t-c", 960, 130, "scratch");
        mk("t-room", 640, 150, "", null, { width: "1px", height: "470px", background: "#2c3138", border: "none" });

        var tb = card(340, 290, 380, '<div class="k" style="color:#c9a79f">team b</div><div class="big">Find the dustiest object in this house.</div>');
        var fa = fig(90, 520, "a");
        fa.style.opacity = 0;
        var arr = arrow("M 110 470 C 120 330, 180 300, 160 290", "amber");
        at(200, function () { show(tb); });
        at(900, function () { show(fa); sfx("pop"); });
        at(1500, function () { arr.draw(700); sfx("whoosh", 0.6); });
        var copy = card(340, 290, 380, '<div class="k" style="color:#9fb7c9">team a &middot; hijacked</div><div class="big">Find the dustiest object in this house.</div>');
        at(2300, function () {
          copy.style.opacity = 1;
          sfx("whoosh");
          glide(copy, { top: "470px" }, 800);
        });
        var win = mk("t-stamp amber t-c", 340, 620, "FIRST ACCEPTED PHOTO WINS", null, { opacity: 0, fontSize: "17px" });
        at(3300, function () { sfx("stamp"); show(win, 200); });

        var sd = disc(960, 300, 150, { scratch: true, hidden: true });
        var bar = mk("t-bar t-c", 960, 480, "<div></div>", null, { opacity: 0 });
        var lbl = mk("t-label t-c", 960, 520, "loading 0:45 · task hidden", null, { opacity: 0 });
        at(4100, function () { show(sd); sfx("whoosh"); });
        at(4700, function () { sd.classList.add("wobble"); sfx("spin"); show(bar); show(lbl); });
        for (var k = 0; k <= 20; k++) {
          (function (k) {
            at(4900 + k * 180, function () {
              bar.firstChild.style.width = (k * 5) + "%";
              lbl.textContent = "loading 0:" + ("0" + Math.max(0, 45 - Math.round(k * 2.25))).slice(-2) + " · task hidden";
            });
          })(k);
        }
        at(8700, function () {
          sd.classList.remove("wobble");
          lbl.textContent = "now they see their task";
          lbl.className = "t-label amber t-c";
          sfx("chime", 72);
        });
      }
    },

    { // 10 --------------------------------------------------------------- the reel
      say: "When time is up, everyone comes back for the reel. Every photo is shown, the room argues about it, and the room decides what counts.",
      build: function () {
        title("9 · the reel");
        var kinds = ["clock", "shoe", "tower", "blur", "lamp"];
        var photos = kinds.map(function (k, i) {
          var p = photo(1500 + i * 250, 330, k);
          p.style.opacity = 1;
          return p;
        });
        var score = card(640, 590, 460, '<div class="k">score</div><div class="big">team a <span id="t-sa">0</span> &nbsp; &middot; &nbsp; team b <span id="t-sb">0</span></div>');
        at(200, function () {
          sfx("whoosh", 1.2);
          photos.forEach(function (p, i) { glide(p, { left: (140 + i * 250) + "px" }, 1500); });
        });
        at(1200, function () { show(score); });
        var verdicts = [["yes", "a"], ["yes", "b"], ["no", "a"], ["no", "b"], ["yes", "a"]];
        var sa = 0, sb = 0;
        verdicts.forEach(function (v, i) {
          at(2100 + i * 700, function () {
            var st = mk("t-stamp " + v[0] + " t-c", 140 + i * 250, 330, v[0] === "yes" ? "IT COUNTS" : "NOPE",
              null, { opacity: 0, fontSize: "20px", transform: "translate(-50%,-50%) rotate(-10deg) scale(1.7)" });
            sfx("stamp");
            glide(st, { opacity: 1, transform: "translate(-50%,-50%) rotate(-10deg) scale(1)" }, 200, "ease-in");
            if (v[0] === "yes") {
              if (v[1] === "a") sa += 10; else sb += 10;
              el("t-sa").textContent = sa; el("t-sb").textContent = sb;
              sfx("coin");
            }
          });
        });
      }
    },

    { // 11 --------------------------------------------------------------- powers and the mole
      say: "Then spend your saved powers, and each team names the Mole on their own team. Get it right for twenty five points. Get it wrong, and the other team gets them.",
      build: function () {
        title("10 · powers, then the mole");
        var pw = mk("t-power live t-c", 200, 360, '<div class="n">LONG COUNT</div><div class="w">double your best</div>', null, { opacity: 0, transform: "translate(-50%,-50%) rotateY(90deg)" });
        at(200, function () { sfx("whoosh"); glide(pw, { opacity: 1, transform: "translate(-50%,-50%) rotateY(0deg)" }, 700); });
        at(1100, function () { sfx("coin"); });
        var xs = [560, 700, 840, 980];
        var figs = xs.map(function (x) { return fig(x, 380, "a"); });
        var spot = mk("t-spot", 0, 0, "", null, { opacity: 0 });
        function aim(x) {
          spot.style.background = "radial-gradient(circle at " + x + "px 380px, rgba(0,0,0,0) 0 90px, rgba(0,0,0,0.8) 150px)";
        }
        aim(560);
        at(1800, function () { show(spot, 400); mk("t-label t-c", 770, 230, "name your mole").style.opacity = 1; });
        [560, 700, 840, 980, 840].forEach(function (x, i) {
          at(2300 + i * 450, function () { aim(x); sfx("tick"); });
        });
        at(4700, function () {
          sfx("sting");
          figs[2].classList.remove("a"); figs[2].classList.add("mole");
          mk("tag", null, null, "MOLE", figs[2]);
        });
        var plus = mk("t-plus t-c", 840, 540, "+25", null, { opacity: 0, transform: "translate(-50%,-50%) scale(0.4)" });
        at(5500, function () {
          sfx("coin");
          glide(plus, { opacity: 1, transform: "translate(-50%,-50%) scale(1)" }, 500, "cubic-bezier(.3,1.6,.5,1)");
        });
      }
    },

    { // 12 --------------------------------------------------------------- end
      say: "Most points wins. The full rules are one button away on the home screen. Now go find some discs.",
      build: function () {
        var logo = mk("t-logo t-c", 640, 300, '<span class="opti">OPTI-</span><span class="mole">MOLE</span>',
          null, { opacity: 0, transform: "translate(-50%,-50%) scale(1.08)" });
        var d1 = disc(360, 520, 70, { spin: true, hidden: true });
        var d2 = disc(640, 520, 70, { spin: true, special: true, hidden: true });
        var d3 = disc(920, 520, 70, { spin: true, hidden: true });
        var sub = mk("t-sub t-c", 640, 640, "most points wins", null, { opacity: 0 });
        at(200, function () { sfx("whoosh", 1.0); glide(logo, { opacity: 1, transform: "translate(-50%,-50%) scale(1)" }, 1400); });
        [d1, d2, d3].forEach(function (d, i) {
          at(1300 + i * 250, function () { sfx("pop"); show(d, 400); });
        });
        at(2300, function () { sfx("chime", 74); setTimeout(function () { sfx("chime", 78); }, 160); setTimeout(function () { sfx("chime", 81); }, 320); show(sub, 900); });
      }
    }
  ];

  function el(id) { return document.getElementById(id); }

  // ------------------------------------------------------------- narration

  var chosenVoice = null;
  function pickVoice() {
    if (!window.speechSynthesis) return null;
    var vs = speechSynthesis.getVoices().filter(function (v) { return /^en/i.test(v.lang); });
    if (!vs.length) return null;
    function find(test) { for (var i = 0; i < vs.length; i++) if (test(vs[i])) return vs[i]; return null; }
    // a natural-sounding online voice if there's internet, otherwise a local one
    return (navigator.onLine && find(function (v) { return /natural/i.test(v.name) && /en-(US|GB)/i.test(v.lang); })) ||
      find(function (v) { return v.localService && /en-US/i.test(v.lang); }) ||
      find(function (v) { return v.localService; }) || vs[0];
  }
  if (window.speechSynthesis) {
    speechSynthesis.onvoiceschanged = function () { chosenVoice = pickVoice(); };
    chosenVoice = pickVoice();
  }

  function words(text) { return text.split(/\s+/).length; }

  var speechToken = 0;       // bumped on every deliberate stop, so stale events are ignored
  var clip = null;           // the recorded narration playing right now, if any
  var clipBroken = {};       // scene index -> true once its clip failed, so we don't retry it

  function duck(on) {
    if (window.OptiMoleSound && OptiMoleSound.duck) OptiMoleSound.duck(on);
  }

  function stopSpeech() {
    speechToken++;
    if (clip) { clip.pause(); clip.removeAttribute("src"); clip.load(); clip = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    duck(false);
  }

  function clipUrl(i) { return "narration/" + ("0" + (i + 1)).slice(-2) + ".mp3"; }

  // The recorded voice first. If there's no clip for this scene, or it won't
  // play, the built-in voice reads the caption instead.
  function speak(text) {
    if (!prefs.voice || clipBroken[S.i]) { speakSynth(text); return; }
    var estimate = words(text) * 380 + 1200;
    S.speechDone = false;
    S.fallbackT = S.t + estimate * 1.6 + 2500;
    stopSpeech();
    var token = speechToken, scene = S.i;
    var a = new Audio(clipUrl(scene));
    clip = a;
    function giveUp() {
      if (token !== speechToken) return;
      clipBroken[scene] = true;
      clip = null;
      speakSynth(text);
    }
    a.onloadedmetadata = function () {
      if (token === speechToken && isFinite(a.duration)) S.fallbackT = S.t + a.duration * 1000 + 4000;
    };
    a.onended = function () {
      if (token !== speechToken) return;
      clip = null;
      S.speechDone = true;
      S.speechEndT = S.t;
      duck(false);
    };
    a.onerror = giveUp;
    var p = a.play();
    if (p && p.then) p.then(function () { if (token === speechToken) duck(true); }, giveUp);
    else duck(true);
    // warm up the next scene's clip so it starts without a gap
    if (scene + 1 < SCENES.length && !clipBroken[scene + 1]) {
      var next = new Audio();
      next.preload = "auto";
      next.src = clipUrl(scene + 1);
    }
  }

  function speakSynth(text, retried) {
    var estimate = words(text) * 380 + 1200;
    S.fallbackT = S.t + estimate * 1.6 + 2500;      // if the voice never reports finishing
    if (!prefs.voice || !window.speechSynthesis) {
      // no voice: give people time to read the caption
      S.speechDone = false;
      S.speechEndT = 0;
      at(S.t + estimate, function () { S.speechDone = true; S.speechEndT = S.t; });
      return;
    }
    S.speechDone = false;
    stopSpeech();
    var token = speechToken, startedAt = null;
    var u = new SpeechSynthesisUtterance(text);
    if (!chosenVoice) chosenVoice = pickVoice();
    if (chosenVoice) u.voice = chosenVoice;
    u.rate = 0.96;
    u.pitch = 0.95;
    u.onstart = function () { startedAt = performance.now(); };
    u.onend = u.onerror = function () {
      if (token !== speechToken) return;              // we stopped this one on purpose
      var spoke = startedAt === null ? 0 : performance.now() - startedAt;
      // Chrome can drop a line spoken just after cancel() and report it
      // "finished" at once. A line that ends far too early gets one more try.
      if (!retried && spoke < estimate * 0.35 && S.playing) {
        setTimeout(function () { if (token === speechToken) speakSynth(text, true); }, 300);
        return;
      }
      S.speechDone = true;
      S.speechEndT = S.t;
      if (window.OptiMoleSound && OptiMoleSound.duck) OptiMoleSound.duck(false);
    };
    setTimeout(function () {
      if (token !== speechToken || !S.playing) return;
      speechSynthesis.speak(u);
      if (window.OptiMoleSound && OptiMoleSound.duck) OptiMoleSound.duck(true);
    }, 150);
  }

  // ------------------------------------------------------------- engine

  function goTo(i) {
    stopSpeech();
    S.i = Math.max(0, Math.min(SCENES.length - 1, i));
    S.t = 0;
    S.steps = [];
    S.ended = false;
    frame.innerHTML = "";
    var scene = SCENES[S.i];
    scene.build();
    var lastStep = 0;
    S.steps.forEach(function (s) { if (s.t > lastStep) lastStep = s.t; });
    S.animEnd = lastStep + 1400;
    caption.style.opacity = 0;
    setTimeout(function () {
      if (S.ended || SCENES[S.i] !== scene) return;   // don't overwrite the end screen's close button
      caption.textContent = scene.say;
      caption.style.opacity = 1;
    }, 150);
    drawProgress();
    S.playing = true;
    updatePlayBtn();
    speak(scene.say);
  }

  function tick(now) {
    if (!root) return;
    if (S.playing) {
      var dt = Math.min(100, now - (S.last || now));
      S.t += dt;
      S.steps.forEach(function (s) {
        if (!s.done && s.t <= S.t) { s.done = true; try { s.fn(); } catch (e) { console.error(e); } }
      });
      var voiceOver = S.speechDone || S.t > S.fallbackT;
      var afterVoice = S.speechDone ? S.t >= S.speechEndT + 800 : S.t > S.fallbackT;
      if (S.t >= S.animEnd && voiceOver && afterVoice) {
        if (S.i < SCENES.length - 1) goTo(S.i + 1);
        else if (!S.ended) finish();
      }
    }
    S.last = now;
    S.raf = requestAnimationFrame(tick);
  }

  function finish() {
    stopSpeech();
    // skipped mid-scene: draw the rest of the logo at once instead of freezing half-faded
    S.steps.forEach(function (s) {
      if (!s.done) { s.done = true; try { s.fn(); } catch (e) {} }
    });
    S.ended = true;
    S.playing = false;
    skipBtn.style.visibility = "hidden";         // nothing left to skip
    caption.style.opacity = 1;
    caption.innerHTML = '<button class="primary" onclick="OptiMoleTutorial.close()">close</button>';
  }

  function pause() {
    if (!S.playing) return;
    S.playing = false;
    if (!S.speechDone) {
      // A recorded clip pauses cleanly and carries on from the same word. The
      // built-in voice doesn't (Chrome), so that one stops and restarts the line.
      if (clip) { clip.pause(); duck(false); }
      else stopSpeech();
    }
    updatePlayBtn();
  }

  function resume() {
    if (S.ended) { goTo(0); return; }
    if (S.playing) return;
    S.playing = true;
    updatePlayBtn();
    if (!S.speechDone && prefs.voice) {
      if (clip) { clip.play(); duck(true); }
      else speak(SCENES[S.i].say);
    }
  }

  function updatePlayBtn() {
    if (playBtn) playBtn.textContent = S.playing ? "pause" : "play";
  }

  function drawProgress() {
    progress.innerHTML = SCENES.map(function (_, i) {
      return '<span class="' + (i < S.i ? "done" : i === S.i ? "now" : "") + '"></span>';
    }).join("");
  }

  function fit() {
    if (!root) return;
    var reserve = 200;                   // caption (up to three lines) + controls
    var scale = Math.min(window.innerWidth / W, (window.innerHeight - reserve) / H);
    frame.style.transform = "scale(" + scale + ")";
    viewport.style.width = W * scale + "px";
    viewport.style.height = H * scale + "px";
  }

  // keys mirror the buttons: right arrow skips, Escape closes - but only on the
  // end screen, same as the close button
  function onKey(e) {
    if (!root) return;
    if (e.key === "Escape" && S.ended) close();
    else if (e.key === "ArrowRight" && !S.ended) skipBtn.click();
  }


  // ------------------------------------------------------------- open / close

  function open() {
    if (root) return;
    if (window.OptiMoleSound && OptiMoleSound.unlock) OptiMoleSound.unlock();
    root = document.createElement("div");
    root.className = "tut";
    root.innerHTML =
      '<div class="tut-progress"></div>' +
      '<div class="tut-viewport"><div class="tut-frame"></div></div>' +
      '<div class="tut-caption"></div>' +
      // just one button while it plays; close only appears on the final screen
      '<div class="tut-controls"><button data-a="skip">skip</button></div>';
    document.body.appendChild(root);
    viewport = root.querySelector(".tut-viewport");
    frame = root.querySelector(".tut-frame");
    caption = root.querySelector(".tut-caption");
    progress = root.querySelector(".tut-progress");
    skipBtn = root.querySelector('[data-a="skip"]');

    skipBtn.addEventListener("click", function () {
      if (S.i >= SCENES.length - 1) finish();   // skipping the last scene goes to the end screen
      else goTo(S.i + 1);
    });

    window.addEventListener("resize", fit);
    document.addEventListener("keydown", onKey);
    fit();
    if (window.OptiMoleSound && OptiMoleSound.song) OptiMoleSound.song.start();
    S.last = 0;
    S.raf = requestAnimationFrame(tick);
    goTo(0);                       // one press and it plays, start to finish, on its own
  }

  function close() {
    if (!root) return;
    stopSpeech();
    if (window.OptiMoleSound && OptiMoleSound.song) OptiMoleSound.song.stop();
    cancelAnimationFrame(S.raf);
    window.removeEventListener("resize", fit);
    document.removeEventListener("keydown", onKey);
    root.remove();
    root = null;
    S.playing = false;
  }

  return {
    open: open,
    close: close,
    replay: function () { goTo(0); },
    _go: function (i) { goTo(i); },
    _state: function () { return { scene: S.i + 1, of: SCENES.length, playing: S.playing, t: Math.round(S.t), speechDone: S.speechDone, ended: S.ended }; }
  };
})();
