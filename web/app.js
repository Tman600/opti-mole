/* OPTI-MOLE - front end. One shared screen, passed around. */

var S = null;             // last server snapshot
var UI = {                // local-only screen state
  draftPlayers: [],
  hideIndex: 0,
  hideShown: false,
  briefIndex: 0,
  briefRole: null,
  briefShown: false,
  capturing: false,
  captureTeam: null,
  hijackTeam: null,
  shot: null,
  stream: null,
  powerTeam: "A",
  powerPick: null,
  editor: false,
  rules: false,
  rulesHtml: null,
  draftHost: "",
  nameErr: "",
  draftMins: "45",
  draftMoleMode: "0",
  hostBrief: null,
  molePick: [],
  moleMsg: "",
  specialPick: [],
  specialMsg: "",
  scratchTeam: null,
  lastPhase: null
};
var CLOCK = { game: 0, task: null, at: 0 };

// ---------------------------------------------------------------- plumbing

function post(action, body) {
  body = body || {};
  body.action = action;
  return fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); }).then(apply);
}

function apply(state) {
  S = state;
  CLOCK.game = state.clock;
  CLOCK.taskA = state.active && state.active.A ? state.active.A.left : null;
  CLOCK.taskB = state.active && state.active.B ? state.active.B.left : null;
  CLOCK.loadA = state.active && state.active.A ? state.active.A.loading : 0;
  CLOCK.loadB = state.active && state.active.B ? state.active.B.loading : 0;
  CLOCK.at = Date.now();
  if (state.phase !== UI.lastPhase) {
    UI.lastPhase = state.phase;
    UI.hideIndex = 0;
    UI.hideShown = false;
    UI.briefIndex = 0;
    UI.briefShown = false;
    UI.briefRole = null;
    UI.powerPick = null;
    UI.hostBrief = null;
    UI.rules = false;
    UI.capturing = false;
    UI.captureTeam = null;
    UI.hijackTeam = null;
    UI.scratchTeam = null;
    UI.specialPick = [];
    UI.specialMsg = "";
    UI.molePick = [];
    UI.moleMsg = "";
    stopCam();
  }
  render();
}

function poll() {
  fetch("/api/state").then(function (r) { return r.json(); }).then(apply).catch(function () {});
}

function mmss(n) {
  if (n === null || n === undefined) return "--:--";
  n = Math.max(0, Math.round(n));
  var m = Math.floor(n / 60), s = n % 60;
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

function esc(t) {
  return String(t === null || t === undefined ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function el(id) { return document.getElementById(id); }

// ---------------------------------------------------------------- the timer

function sideClock(node, team, base, drift, loading) {
  if (base === null || base === undefined) {
    node.className += " side-idle";
    node.textContent = "team " + team.toLowerCase() + " · no task";
    return;
  }
  var load = Math.max(0, (loading || 0) - drift);
  if (load > 0) {
    node.className += " side-task";
    node.innerHTML = '<span class="lbl team' + team + '">team ' + team.toLowerCase() +
      ' &middot; scratched, loading</span>' + mmss(load);
    return;
  }
  var left = Math.max(0, base - drift);
  node.className += " side-task" + (left <= 15 ? " urgent" : "");
  node.innerHTML = '<span class="lbl team' + team + '">team ' + team.toLowerCase() + ' task</span>' +
    mmss(left);
}

function tick() {
  if (!S) return;
  var drift = (Date.now() - CLOCK.at) / 1000;
  var game = Math.max(0, CLOCK.game - drift);

  var big = el("bigclock"), cap = el("clockcap");
  var gameEl = el("gameclock"), discEl = el("discs");
  discEl.className = "discs";
  gameEl.className = "game";

  if (S.phase === "play") {
    // Both teams can have a task running at once, so the game clock keeps the
    // centre and each team's task clock sits on its own side: A left, B right.
    document.body.classList.remove("no-timer");
    big.textContent = mmss(game);
    big.className = "big" + (game <= 60 ? " urgent" : "");
    cap.textContent = "game clock · " + S.discs_left + " / " + S.discs_total + " discs left";
    sideClock(discEl, "A", CLOCK.taskA, drift, CLOCK.loadA);
    sideClock(gameEl, "B", CLOCK.taskB, drift, CLOCK.loadB);
    var lc;
    ["A", "B"].forEach(function (t) {
      if ((lc = el("loadclock" + t))) lc.textContent = mmss(Math.max(0, CLOCK["load" + t] - drift));
    });
  } else if (S.phase === "reel") {
    document.body.classList.remove("no-timer");
    big.textContent = (S.reel_index + 1) + " / " + S.log.length;
    big.className = "big task";
    cap.textContent = "the reel";
    gameEl.textContent = "";
    discEl.textContent = "";
  } else if (S.phase === "record" || S.phase === "powers" ||
             S.phase === "accusation" || S.phase === "results") {
    document.body.classList.remove("no-timer");
    big.textContent = S.totals.A + " – " + S.totals.B;
    big.className = "big";
    cap.textContent = "team a · team b";
    gameEl.textContent = "";
    discEl.textContent = "";
  } else {
    document.body.classList.add("no-timer");
  }
}

// ---------------------------------------------------------------- screens

var LAST_SIG = null;

/* The stage must NOT be rebuilt on every poll - people are clicking these
   buttons in a hurry and a button that vanishes mid-press is a lost turn.
   Only redraw when something other than the clock has actually moved. */
function signature() {
  var vol = { clock: 0, active: S.active ? Object.keys(S.active).length : 0 };
  return JSON.stringify([
    S.phase, S.message, S.collection, S.custom, S.players, S.pending,
    ["A", "B"].map(function (t) {
      var a = S.active && S.active[t];
      return a && [a.text, a.power, a.hijack_of, a.contested, a.loading > 0];   // never .left: it ticks
    }),
    S.hijacks, S.can_hijack, UI.captureTeam, UI.hijackTeam,
    S.scratches, S.can_scratch, S.slowed, UI.scratchTeam, UI.specialPick, UI.specialMsg,
    S.leads, S.discs_left, S.log.length, S.reel_index, S.powers, S.spent,
    S.accusations, S.totals, S.notes, S.phones, S.join, S.vote, S.seated,
    UI.editor, UI.hideIndex, UI.hideShown, UI.briefIndex, UI.briefShown, UI.briefRole,
    UI.capturing, UI.shot ? UI.shot.length : 0, UI.powerTeam, UI.powerPick,
    UI.draftPlayers, UI.nameErr, vol, S.host, UI.rules, !!UI.rulesHtml, UI.hostBrief, UI.molePick, UI.moleMsg
  ]);
}

function render(force) {
  if (!S) return;
  tick();
  if (window.OptiMoleSound) OptiMoleSound.menu(S.phase === "setup");
  var sig = signature();
  if (!force && sig === LAST_SIG) return;
  LAST_SIG = sig;

  // the background takes its colour from where the night is up to
  var movedOn = document.body.dataset.phase !== S.phase;
  document.body.dataset.phase = S.phase;

  var keep = document.activeElement;
  var keepId = keep && keep.id ? keep.id : null;
  var keepVal = keep && "value" in keep ? keep.value : null;

  var f = ({
    setup: viewSetup, hiding: viewHiding, briefing: viewBriefing, play: viewPlay,
    reel: viewReel, record: viewRecord, powers: viewPowers,
    accusation: viewAccusation, results: viewResults
  })[S.phase] || viewSetup;
  el("stage").innerHTML = f();

  // panels rise in when the night moves on - never on a routine redraw, or the
  // screen would twitch every time a score or a clock changed
  if (movedOn) {
    var st = el("stage");
    st.classList.remove("enter");
    void st.offsetWidth;
    st.classList.add("enter");
  }

  if (keepId) {
    var back = el(keepId);
    if (back) {
      if (keepVal !== null && "value" in back) back.value = keepVal;
      back.focus();
    }
  }
  if (UI.capturing && !UI.shot) startCam();
}

/* ---- setup ---- */

function viewSetup() {
  if (UI.editor) return viewEditor();
  if (UI.rules) return viewRules();

  var discs = S.collection.map(function (d, i) {
    return '<div class="item"><span class="dim" style="width:28px">' + (i + 1) + '</span>' +
      '<input class="flex" value="' + esc(d.name) + '" ' +
      'onchange="post(\'rename\',{fingerprint:\'' + d.fingerprint + '\',name:this.value})">' +
      '<span class="pill">' + esc(d.fingerprint.slice(0, 6)) + '</span></div>';
  }).join("") || '<div class="item dim">Nothing registered yet.</div>';

  var players = UI.draftPlayers.map(function (p, i) {
    return '<div class="item"><span class="flex ' + (p.team === "A" ? "teamA" : "teamB") + '">' +
      esc(p.name) + '</span>' +
      '<button onclick="flipTeam(' + i + ')">team ' + p.team + '</button>' +
      '<button class="bad" onclick="dropPlayer(' + i + ')">x</button></div>';
  }).join("") || '<div class="item dim">Nobody yet. Four minimum.</div>';

  // Always offer this, not just when no drive is found - a drive can be present
  // and still hand you nothing readable, and you still want to play.
  var sim =
    '<div class="hr"></div><h2>simulator</h2>' +
    '<div class="small dim" style="margin-bottom:10px">' +
    (S.sim ? 'No optical drive detected. ' : 'No discs handy, or the drive is being difficult. ') +
    'These stand in for real discs so you can play the whole game without any.</div>' +
    '<button onclick="simBatch()">register 20 fake discs</button>';

  return '' +
  '<div class="center"><h1 class="brand"><span class="opti">OPTI-</span><span class="mole">MOLE</span></h1>' +
  '<div class="sub">insert each disc once &middot; the drive does the rest</div></div>' +
  '<div class="row">' +

    '<div class="grow panel">' +
      '<h2 style="margin-top:0">1 &middot; the collection</h2>' +
      '<div class="small dim" style="margin-bottom:12px">Put a disc in the tray. It is fingerprinted and ' +
      'remembered forever. Any DVD works &mdash; the game never plays them.</div>' +
      '<div class="msg">' + esc(S.message) + '</div>' +
      '<div class="list">' + discs + '</div>' +
      '<div style="margin-top:12px" class="small dim">' + S.collection.length +
      ' registered &middot; 8 minimum, 20 used per game</div>' +
      '<div style="margin-top:12px"><button class="bad" onclick="if(confirm(\'Forget every registered disc?\'))post(\'forget\')">forget collection</button></div>' +
      sim +
    '</div>' +

    '<div class="grow panel">' +
      '<h2 style="margin-top:0">2 &middot; the room</h2>' +
      '<label>add a player</label>' +
      '<div style="display:flex;gap:10px">' +
        '<input id="pname" placeholder="name" onkeydown="if(event.key===\'Enter\')addPlayer()">' +
        '<button onclick="addPlayer()">add</button>' +
      '</div>' +
      (UI.nameErr ? '<div class="msg">' + esc(UI.nameErr) + '</div>' : '') +
      '<div class="list" style="margin-top:14px">' + players + '</div>' +

      '<label>host &mdash; optional, does not play</label>' +
      '<input id="hostname" placeholder="leave empty for no host" value="' + esc(UI.draftHost) + '" ' +
        'oninput="UI.draftHost=this.value">' +
      '<div class="small dim" style="margin-top:6px">The host hides the special discs, gives ' +
        'clues out loud, and may pick the Moles.</div>' +

      // these remember their value: the panel is rebuilt every time a player is
      // added, which used to snap them back to the defaults
      '<label>game length</label>' +
      '<select id="mins" onchange="UI.draftMins=this.value">' +
        [["25", "25 minutes"], ["35", "35 minutes"], ["45", "45 minutes"], ["60", "60 minutes"]]
          .map(function (o) {
            return '<option value="' + o[0] + '"' + (UI.draftMins === o[0] ? " selected" : "") +
              '>' + o[1] + '</option>';
          }).join("") +
      '</select>' +

      '<label>moles</label>' +
      '<select id="molemode" onchange="UI.draftMoleMode=this.value">' +
        '<option value="0"' + (UI.draftMoleMode === "0" ? " selected" : "") +
          '>one per team (6+ players)</option>' +
        '<option value="1"' + (UI.draftMoleMode === "1" ? " selected" : "") +
          '>one, somewhere (4-6 players)</option>' +
      '</select>' +

      '<div class="hr"></div>' +
      '<div class="row">' +
        '<button class="grow primary" onclick="OptiMoleTutorial.open()">&#9654; tutorial</button>' +
        '<button class="grow" onclick="openRules()">rules</button>' +
        '<button class="grow" onclick="UI.editor=true;render()">write your own tasks &nbsp;(' +
          S.custom.length + ')</button>' +
      '</div>' +
      '<div style="margin-top:12px">' +
      '<button class="primary wide huge" onclick="startGame()">begin</button></div>' +
    '</div>' +
  '</div>';
}

function sameName(a, b) {
  return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
}

function addPlayer() {
  var v = el("pname").value.replace(/\s+/g, " ").trim();
  if (!v) return;
  // names are how roles, hiding and accusations find a person - two "r"s break all three
  var taken = UI.draftPlayers.some(function (p) { return sameName(p.name, v); });
  if (taken || (UI.draftHost && sameName(UI.draftHost, v))) {
    UI.nameErr = '"' + v + '" is already ' + (taken ? "playing" : "the host") + ". Pick a different name.";
    render();
    var f0 = el("pname"); if (f0) { f0.select(); f0.focus(); }
    return;
  }
  UI.nameErr = "";
  var a = UI.draftPlayers.filter(function (p) { return p.team === "A"; }).length;
  var b = UI.draftPlayers.length - a;
  UI.draftPlayers.push({ name: v, team: a <= b ? "A" : "B" });
  el("pname").value = "";
  render();
  var f = el("pname"); if (f) f.focus();
}
function flipTeam(i) { UI.draftPlayers[i].team = UI.draftPlayers[i].team === "A" ? "B" : "A"; render(); }
function dropPlayer(i) { UI.draftPlayers.splice(i, 1); render(); }

function simBatch() {
  var chain = Promise.resolve();
  for (var i = 1; i <= 20; i++) {
    (function (n) {
      chain = chain.then(function () { return post("sim_register", { n: n, label: "SIM DISC " + n }); });
    })(i);
  }
}

function startGame() {
  post("start", {
    players: UI.draftPlayers,
    minutes: parseInt(UI.draftMins, 10),
    single_mole: UI.draftMoleMode === "1",
    host: UI.draftHost.trim()
  });
}

/* ---- rules ---- */

// web/RULES.md is the one copy of the rules. This screen renders that same
// file, so the printed rules and the in-game rules can never disagree.
function openRules() {
  UI.rules = true;
  render();
  if (UI.rulesHtml) return;
  fetch("RULES.md").then(function (r) { return r.text(); }).then(function (md) {
    UI.rulesHtml = renderRules(md);
    LAST_SIG = null;
    render();
  });
}

function renderRules(md) {
  function inline(t) {
    return esc(t).replace(/\*\*(.+?)\*\*/g, "<b style=\"color:#fff\">$1</b>")
                 .replace(/\*(.+?)\*/g, "<i>$1</i>");
  }
  var out = [], list = null;
  function close() { if (list) { out.push("</" + list + ">"); list = null; } }
  md.split(/\r?\n/).forEach(function (line) {
    var m;
    if (/^# /.test(line)) { close(); return; }                       // title shown by the page
    if ((m = line.match(/^## (.+)/))) { close(); out.push("<h2>" + inline(m[1]) + "</h2>"); return; }
    if (/^\|[-| ]+\|$/.test(line)) return;                             // table divider
    if ((m = line.match(/^\| (.+) \| (.+) \|$/))) {
      close();
      if (m[1] === "Power") return;                                    // table header
      out.push('<div class="item"><span class="pill amber" style="min-width:120px;text-align:center">' +
        inline(m[1]) + '</span><span class="flex">' + inline(m[2]) + '</span></div>');
      return;
    }
    if ((m = line.match(/^\s+- (.+)/))) {
      out.push('<div class="small" style="margin:4px 0 4px 34px">&middot; ' + inline(m[1]) + '</div>');
      return;
    }
    if ((m = line.match(/^(\d+)\. (.+)/))) {
      if (list !== "ol") { close(); out.push('<ol style="margin:0;padding-left:24px">'); list = "ol"; }
      out.push('<li style="margin:8px 0">' + inline(m[2]) + '</li>');
      return;
    }
    if ((m = line.match(/^- (.+)/))) {
      if (list !== "ul") { close(); out.push('<ul style="margin:0;padding-left:24px">'); list = "ul"; }
      out.push('<li style="margin:8px 0">' + inline(m[1]) + '</li>');
      return;
    }
    if (line.trim()) { close(); out.push("<p>" + inline(line) + "</p>"); }
  });
  close();
  return out.join("");
}

function viewRules() {
  return '<div class="center"><h1>RULES</h1>' +
    '<div class="sub">read it once &middot; argue about it forever</div></div>' +
    '<div class="card" style="font-size:17px;line-height:1.5">' +
      (UI.rulesHtml || '<div class="dim center">loading&hellip;</div>') +
      '<div class="hr"></div><div class="center">' +
      '<button class="primary huge" onclick="UI.rules=false;render()">back</button></div>' +
    '</div>';
}

/* ---- task editor ---- */

function viewEditor() {
  var rows = S.custom.map(function (c, i) {
    return '<div class="item"><span class="flex">' + esc(c.text) +
      '<br><span class="small dim">' + c.seconds + 's &middot; ' + c.judged +
      (c.author ? ' &middot; ' + esc(c.author) : '') + '</span></span>' +
      '<button class="bad" onclick="post(\'delete_task\',{index:' + i + '})">x</button></div>';
  }).join("") || '<div class="item dim">No house tasks yet.</div>';

  return '' +
  '<div class="center"><h1>TASKS</h1>' +
  '<div class="sub">four fields &middot; anyone can write one in twenty seconds</div></div>' +
  '<div class="row">' +
    '<div class="grow panel">' +
      '<label>the instruction</label>' +
      '<textarea id="t_text" rows="3" placeholder="Bring back the ugliest thing in this house."></textarea>' +
      '<label>time limit</label>' +
      '<select id="t_secs">' +
        '<option value="30">30 seconds</option><option value="60">1 minute</option>' +
        '<option value="120" selected>2 minutes</option><option value="180">3 minutes</option>' +
        '<option value="300">5 minutes</option></select>' +
      '<label>judged by</label>' +
      '<select id="t_judged">' +
        '<option value="vote">vote &mdash; the room decides</option>' +
        '<option value="pass">pass / fail &mdash; you did it or you did not</option>' +
        '<option value="race">race &mdash; first team back scores more</option></select>' +
      '<label>written by</label>' +
      '<input id="t_author" placeholder="your name">' +
      '<div style="margin-top:18px">' +
        '<button class="primary" onclick="saveTask()">add to the pool</button> ' +
        '<button onclick="UI.editor=false;render()">done</button>' +
      '</div>' +
      '<div class="small dim" style="margin-top:16px">Your tasks get dealt onto discs alongside the ' +
      'built-in ones, and the screen credits you when one fires.</div>' +
    '</div>' +
    '<div class="grow panel"><h2 style="margin-top:0">house tasks</h2>' +
      '<div class="list" style="max-height:520px">' + rows + '</div></div>' +
  '</div>';
}

function saveTask() {
  var t = el("t_text").value.trim();
  if (!t) return;
  post("add_task", {
    text: t,
    seconds: parseInt(el("t_secs").value, 10),
    judged: el("t_judged").value,
    author: el("t_author").value.trim()
  }).then(function () { el("t_text").value = ""; });
}

/* ---- hiding ---- */

function viewHiding() {
  var names = S.players.map(function (p) { return p.name; });

  // With a host, the host takes the laptop first: special discs, then Moles.
  var offset = S.host ? 1 : 0;
  if (S.host && UI.hideIndex === 0) return viewHostTurn();

  if (UI.hideIndex >= names.length + offset) {
    return '<div class="card center">' +
      '<div class="kicker">everything is hidden</div>' +
      '<div class="tasktext">Nobody in this room knows the whole map.</div>' +
      '<div class="dim" style="margin-bottom:26px">Next: one at a time, each player reads their role. ' +
      'Do not let anyone see the screen but you.</div>' +
      '<button class="primary huge" onclick="post(\'to_briefing\')">roles</button>' +
      '</div>';
  }

  var who = names[UI.hideIndex - offset];

  // Gate it. The list stays covered until the named player says they have the
  // laptop, otherwise the whole room reads everyone's hiding places over their
  // shoulder and the map is not hidden at all.
  if (!UI.hideShown) {
    return '<div class="card center">' +
      '<div class="kicker">hand the laptop to</div>' +
      '<div class="tasktext">' + esc(who) + '</div>' +
      '<div class="dim" style="margin-bottom:30px">Everyone else look away. ' +
      'These are yours alone.</div>' +
      '<button class="primary huge" onclick="UI.hideShown=true;render()">' +
      'i am ' + esc(who) + ' &mdash; show my discs</button></div>';
  }

  var mine = S.hiding.filter(function (h) { return h.name === who; });
  var list = mine.map(function (h) {
    return '<div class="item"><span class="pill amber">' + esc(h.disc) + '</span>' +
      '<span class="flex spot" style="font-size:22px">' + esc(h.spot) + '</span></div>';
  }).join("");

  return '<div class="card">' +
    '<div class="kicker">' + esc(who) + ' &middot; hide these, then hide the screen</div>' +
    '<div class="list" style="max-height:none;margin-top:18px">' + list + '</div>' +
    '<div style="margin-top:26px" class="center">' +
    '<button class="primary huge" onclick="UI.hideIndex++;UI.hideShown=false;render()">' +
    'hidden &mdash; next player</button></div>' +
    '</div>';
}

/* ---- the host's turn ---- */

function viewHostTurn() {
  if (!UI.hideShown) {
    return '<div class="card center">' +
      '<div class="kicker">hand the laptop to the host</div>' +
      '<div class="tasktext">' + esc(S.host) + '</div>' +
      '<div class="dim" style="margin-bottom:30px">Everyone else look away. The host is about to ' +
      'see where the special discs go, and who the Moles are.</div>' +
      '<button class="primary huge" onclick="openHostBrief()">i am the host &mdash; show me</button></div>';
  }

  var b = UI.hostBrief;
  if (!b) return '<div class="card center dim">loading&hellip;</div>';

  var specials = b.specials.map(function (s, i) {
    return '<div class="item" style="align-items:flex-start;padding:16px 14px">' +
      '<span class="dim" style="width:22px;font-size:20px">' + (i + 1) + '</span>' +
      '<div class="flex">' +
        '<div><span class="pill amber">' + esc(s.disc) + '</span> &nbsp;' +
          '<span class="spot" style="font-size:24px">' + esc(s.spot) + '</span></div>' +
        '<div style="margin-top:8px"><span class="pill">' + esc(s.power) + '</span> &nbsp;' +
          '<span class="small">' + esc(s.does) + '</span></div>' +
        '<div class="small dim" style="margin-top:6px">task: ' + esc(s.task) + '</div>' +
      '</div></div>';
  }).join("");

  var picks = b.pool.map(function (p) {
    var on = UI.specialPick.indexOf(p.power) !== -1;
    return '<button class="' + (on ? "primary" : "") + '" style="margin:4px;text-align:left" ' +
      'title="' + esc(p.does) + '" onclick="toggleSpecial(\'' + p.power + '\')">' +
      esc(p.power) + ' <span class="small" style="opacity:0.7">&middot; ' +
      (p.when === "play" ? "during play" : "end of game") + '</span></button>';
  }).join("");

  var roster = b.players.map(function (p) {
    var on = UI.molePick.indexOf(p.name) !== -1;
    return '<button class="' + (on ? "primary" : "") + '" style="margin:4px" ' +
      'onclick="toggleMole(\'' + esc(p.name).replace(/'/g, "\\'") + '\',\'' + p.team + '\')">' +
      esc(p.name) + ' &middot; ' + p.team + (on ? ' &middot; mole' : '') + '</button>';
  }).join("");

  return '<div class="card">' +
    '<div class="kicker">' + esc(b.host) + ' &middot; host &middot; nobody else may read this</div>' +

    '<h2>1 &middot; hide the special discs</h2>' +
    '<div class="small dim" style="margin-bottom:10px">Put each disc in the place described. ' +
    'Only you will know where these are.</div>' +
    '<div class="list" style="max-height:none">' + specials + '</div>' +

    '<h2>2 &middot; the powers</h2>' +
    '<div class="small dim" style="margin-bottom:10px">' + b.per_game + ' powers are live this game. ' +
      'The computer picked the highlighted ones. Keep them, or pick your own &mdash; the discs and ' +
      'hiding spots above stay the same, only the powers change.</div>' +
    '<div>' + picks + '</div>' +
    '<div style="margin-top:12px"><button onclick="saveSpecials()">save powers</button>' +
      ' <span class="msg" style="margin-left:10px">' + esc(UI.specialMsg) + '</span></div>' +

    '<h2>3 &middot; your clues</h2>' +
    '<div class="panel">You may give at most <b style="color:#fff">3 minor clues</b> and ' +
      '<b style="color:#fff">2 big clues</b> all game, out loud, whenever and to whichever team you like.' +
      '<div class="small dim" style="margin-top:8px">Minor narrows it down &mdash; a floor, a kind of ' +
      'room, warmer or colder. Big names the room or the spot. The app does not count them; that is ' +
      'your job.</div></div>' +

    '<h2>4 &middot; the moles</h2>' +
    '<div class="small dim" style="margin-bottom:10px">' +
      (b.single_mole ? 'One Mole this game. ' : 'One Mole per team. ') +
      'They were picked at random and are highlighted. Keep them, or tap to pick your own.</div>' +
    '<div>' + roster + '</div>' +
    '<div style="margin-top:12px"><button onclick="saveMoles()">save moles</button>' +
      ' <span class="msg" style="margin-left:10px">' + esc(UI.moleMsg) + '</span></div>' +

    '<div class="hr"></div><div class="center">' +
    '<button class="primary huge" onclick="hostDone()">hidden &mdash; next player</button></div>' +
    '</div>';
}

function hostCall(action, extra, done) {
  var body = extra || {};
  body.action = action;
  fetch("/api/action", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); }).then(done);
}

function livePowers(b) {
  return b ? b.specials.map(function (s) { return s.power; }) : [];
}

function toggleSpecial(power) {
  var i = UI.specialPick.indexOf(power);
  if (i !== -1) UI.specialPick.splice(i, 1);
  else UI.specialPick.push(power);
  var n = UI.hostBrief.per_game;
  UI.specialMsg = UI.specialPick.length === n ? "not saved yet"
    : "pick " + n + " (" + UI.specialPick.length + " picked)";
  render();
}

function saveSpecials(then) {
  hostCall("set_specials", { powers: UI.specialPick }, function (j) {
    UI.specialMsg = j.ok ? "saved" : j.error;
    if (j.ok && j.brief) { UI.hostBrief = j.brief; UI.specialPick = livePowers(j.brief); }
    render();
    if (j.ok && then) then();
  });
}

function openHostBrief() {
  hostCall("host_brief", {}, function (j) {
    UI.hostBrief = j.brief;
    UI.specialPick = livePowers(j.brief);
    UI.specialMsg = "";
    UI.molePick = j.brief ? j.brief.moles.slice() : [];
    UI.moleMsg = "";
    UI.hideShown = true;
    render();
  });
}

function toggleMole(name, team) {
  var b = UI.hostBrief;
  if (b.single_mole) {
    UI.molePick = [name];
  } else {
    // one per team: picking someone replaces whoever was picked on their team
    var teamOf = {};
    b.players.forEach(function (p) { teamOf[p.name] = p.team; });
    UI.molePick = UI.molePick.filter(function (n) { return teamOf[n] !== team; });
    UI.molePick.push(name);
  }
  UI.moleMsg = "not saved yet";
  render();
}

function saveMoles(then) {
  hostCall("set_moles", { names: UI.molePick }, function (j) {
    UI.moleMsg = j.ok ? "saved" : j.error;
    // on an error keep the host's picks on screen so they can fix them
    if (j.ok && j.brief) { UI.hostBrief = j.brief; UI.molePick = j.brief.moles.slice(); }
    render();
    if (j.ok && then) then();
  });
}

function hostDone() {
  function next() {
    UI.hideIndex++; UI.hideShown = false; UI.hostBrief = null;
    UI.moleMsg = ""; UI.specialMsg = "";
    render();
  }
  var n = UI.hostBrief ? UI.hostBrief.per_game : 3;
  if (UI.specialPick.length !== n) {
    UI.specialMsg = "pick exactly " + n + " powers before moving on";
    render();
    return;
  }
  // unsaved picks are saved on the way out, never silently thrown away
  function moles() { if (UI.moleMsg === "not saved yet") saveMoles(next); else next(); }
  if (UI.specialMsg === "not saved yet") saveSpecials(moles); else moles();
}

/* ---- briefing ---- */

function viewBriefing() {
  var names = S.players.map(function (p) { return p.name; });
  if (UI.briefIndex >= names.length) {
    var ready = ((S.phones || {}).A || 0) + ((S.phones || {}).B || 0);
    return '<div class="card center">' +
      '<div class="kicker">everyone knows who they are</div>' +
      '<div class="tasktext">Put the laptop back where the drive is.</div>' +
      '<div class="dim">From here it never moves. Every disc comes to it.</div>' +
      '<div class="panel" style="margin:26px 0">' +
        '<div class="small dim">phones on</div>' +
        '<div class="lead" style="font-family:var(--mono)">' + esc(S.join || "") + '</div>' +
        '<div class="small ' + (ready ? "" : "dim") + '" style="margin-top:8px">' +
        (ready ? ready + ' connected &middot; team a ' + ((S.phones || {}).A || 0) +
                 ', team b ' + ((S.phones || {}).B || 0)
               : 'nobody has joined yet &mdash; you can still start, but the photos ' +
                 'will have to come off the laptop webcam') +
        '</div></div>' +
      '<button class="primary huge" onclick="post(\'begin_play\')">start the clock</button></div>';
  }
  var who = names[UI.briefIndex];

  if (!UI.briefShown) {
    return '<div class="card center">' +
      '<div class="kicker">alone with the screen</div>' +
      '<div class="tasktext">' + esc(who) + '</div>' +
      '<button class="primary huge" onclick="showRole(\'' + esc(who).replace(/'/g, "\\'") +
      '\')">reveal my role</button></div>';
  }

  var r = UI.briefRole || {};
  var body = r.mole
    ? '<div class="kicker" style="color:#d64c42">you are the mole</div>' +
      '<div class="tasktext">You play for Team ' + r.team + ' all night.<br>You win only if Team ' +
      r.loyal_to + ' wins.</div>' +
      '<div class="dim">Once tonight you may quietly re-hide a disc your team is holding. ' +
      'Say nothing. Everything else is just being trusted.</div>'
    : '<div class="kicker">loyal</div>' +
      '<div class="tasktext">Team ' + r.team + '.<br>You want Team ' + r.team + ' to win.</div>' +
      '<div class="dim">Someone in this room is not what they say they are.</div>';

  // The passcode only ever appears here, one player alone with the screen.
  // Printing it on the shared screen would hand it to the other team.
  var phone = '<div class="panel" style="margin-top:30px;text-align:left">' +
    '<div class="kicker">your phone</div>' +
    '<div class="row" style="align-items:center;margin-top:10px">' +
      '<div class="grow"><div class="small dim">open this</div>' +
        '<div class="lead" style="font-family:var(--mono)">' + esc(r.join || "") + '</div></div>' +
      '<div class="grow"><div class="small dim">team ' + r.team + ' code</div>' +
        '<div style="font-family:var(--mono);font-size:52px;letter-spacing:0.3em;color:var(--amber)">' +
        esc(r.code || "") + '</div></div>' +
    '</div>' +
    '<div class="small dim" style="margin-top:10px">Same wifi as this computer. ' +
    'The code claims discs and the phone takes the photos. Do not say it out loud.</div>' +
    '</div>';

  return '<div class="card center">' + body + phone +
    '<div style="margin-top:26px"><button class="primary huge" ' +
    'onclick="UI.briefIndex++;UI.briefShown=false;UI.briefRole=null;render()">' +
    'understood &mdash; next player</button></div></div>';
}

function showRole(name) {
  fetch("/api/action", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "role", name: name })
  }).then(function (r) { return r.json(); }).then(function (j) {
    UI.briefRole = j.role; UI.briefShown = true; render();
  });
}

/* ---- play ---- */

function viewPlay() {
  function phones(t) {
    var n = (S.phones || {})[t] || 0;
    return n ? (n + (n === 1 ? " phone" : " phones")) : "no phones";
  }
  var head =
    '<div class="scorebar">' +
      '<div><div class="t teamA">team a &middot; ' + phones("A") + '</div>' +
        '<div class="n">' + S.totals.A + '</div>' +
        '<div class="small dim">lead: ' + esc(S.leads.A || "nothing left") + '</div></div>' +
      '<div><div class="t teamB">team b &middot; ' + phones("B") + '</div>' +
        '<div class="n">' + S.totals.B + '</div>' +
        '<div class="small dim">lead: ' + esc(S.leads.B || "nothing left") + '</div></div>' +
    '</div>';

  if (UI.capturing && UI.captureTeam && S.active[UI.captureTeam]) {
    return head + capturePanel(UI.captureTeam);
  }

  var body;

  if (S.pending) {
    body = '<div class="card center">' +
      '<div class="spin">&bull; &bull; &bull;</div>' +
      '<div class="kicker" style="margin-top:18px">disc read</div>' +
      '<div class="tasktext">' + esc(S.pending.name) + '</div>' +
      '<div class="dim" style="margin-bottom:22px">Claim it with your team code, ' +
      'or hit claim on a phone. A team with a task already running can\'t claim.</div>' +
      '<input id="claimcode" type="text" inputmode="numeric" maxlength="4" ' +
        'placeholder="0000" autocomplete="off" oninput="onClaimCode(this)" ' +
        'style="font-family:var(--mono);font-size:64px;text-align:center;' +
        'letter-spacing:0.4em;text-indent:0.4em;padding:20px 0;max-width:460px;margin:0 auto">' +
      '<div class="msg center">' + esc(S.message) + '</div>' +
      '<button onclick="post(\'release\')">put it back &mdash; nobody claims it</button></div>';
  } else {
    var sim = "";
    if (S.sim) {
      sim = '<div class="hr"></div><div class="small dim" style="margin-bottom:8px">simulator</div><div class="row">' +
        S.collection.slice(0, 20).map(function (d) {
          return '<button class="small" onclick="post(\'sim_insert\',{fingerprint:\'' +
            d.fingerprint + '\'})">' + esc(d.name) + '</button>';
        }).join("") + '</div>';
    }
    // Tray empty: the two teams' tasks are what matters, so they go on top and
    // the tray shrinks to a strip underneath.
    body = '<div class="panel" style="margin-top:18px;display:flex;align-items:center;gap:18px;flex-wrap:wrap">' +
      '<div class="grow"><span class="kicker">tray empty</span> &nbsp;' +
        '<span class="dim">Find a disc, bring it here. ' + S.discs_left + ' of ' + S.discs_total +
        ' still hidden.</span>' +
        (S.message ? '<div class="msg" style="margin:6px 0 0">' + esc(S.message) + '</div>' : '') +
      '</div>' +
      '<button onclick="if(confirm(\'End play and go to the reel?\'))post(\'to_reel\')">' +
      'call it &mdash; go to the reel</button>' +
      (sim ? '<div style="flex-basis:100%">' + sim + '</div>' : '') +
      '</div>';
  }

  var lanes = '<div class="row" style="align-items:stretch' + (S.pending ? ';margin-top:18px' : '') + '">' +
    lane("A") + lane("B") + '</div>';
  return S.pending ? head + body + lanes : head + lanes + body;
}

/* one column per team: its running task (or nothing), and the play powers it holds */
function codeBox(id, label, handler, cancel) {
  return '<div class="panel" style="margin-top:14px">' +
    '<div class="small" style="margin-bottom:8px">' + label + '</div>' +
    '<input id="' + id + '" type="text" inputmode="numeric" maxlength="4" placeholder="0000" ' +
      'autocomplete="off" oninput="' + handler + '(this)" style="font-family:var(--mono);' +
      'font-size:36px;text-align:center;letter-spacing:0.4em;text-indent:0.4em">' +
    '<button style="margin-top:10px" onclick="' + cancel + '=null;render()">cancel</button></div>';
}

function powersBlock(t, idle) {
  var other = t === "A" ? "B" : "A";
  var out = "";
  var hj = (S.hijacks || {})[t] || 0, sc = (S.scratches || {})[t] || 0;

  if (idle) {
    if (UI.hijackTeam === t) {
      out += codeBox("hijackcode", "Team " + t + " code to HIJACK Team " + other + "'s task:",
        "onHijackCode", "UI.hijackTeam");
    } else if ((S.can_hijack || {})[t]) {
      out += '<button class="primary wide" style="margin-top:14px" ' +
        'onclick="UI.hijackTeam=\'' + t + '\';UI.scratchTeam=null;render();var f=el(\'hijackcode\');if(f)f.focus()">' +
        'use hijack on team ' + other.toLowerCase() + '\'s task</button>';
    } else if (hj) {
      out += '<div class="small" style="margin-top:12px;color:var(--amber)">Holding ' + hj +
        ' HIJACK &mdash; usable when Team ' + other + ' has a task running.</div>';
    }
  } else if (hj) {
    out += '<div class="small" style="margin-top:12px;color:var(--amber)">Holding ' + hj +
      ' HIJACK &mdash; usable once this task is done.</div>';
  }

  // SCRATCH hits the other team's NEXT disc, so it works whether or not you're busy
  if (UI.scratchTeam === t) {
    out += codeBox("scratchcode", "Team " + t + " code to SCRATCH Team " + other + "'s next disc:",
      "onScratchCode", "UI.scratchTeam");
  } else if ((S.can_scratch || {})[t]) {
    out += '<button class="primary wide" style="margin-top:14px" ' +
      'onclick="UI.scratchTeam=\'' + t + '\';UI.hijackTeam=null;render();var f=el(\'scratchcode\');if(f)f.focus()">' +
      'use scratch on team ' + other.toLowerCase() + '\'s next disc</button>';
  } else if (sc) {
    out += '<div class="small" style="margin-top:12px;color:var(--amber)">Holding ' + sc +
      ' SCRATCH &mdash; Team ' + other + '\'s next disc is already scratched.</div>';
  }

  if ((S.slowed || {})[t]) {
    out += '<div class="small" style="margin-top:12px;color:#d64c42">Team ' + t +
      '\'s next disc is SCRATCHED &mdash; it will load for a while before its task appears.</div>';
  }
  return out;
}

function lane(t) {
  var a = S.active[t];
  var other = t === "A" ? "B" : "A";
  var name = '<div class="kicker team' + t + '" style="color:inherit">team ' + t.toLowerCase() + '</div>';

  if (!a) {
    return '<div class="grow panel">' + name +
      '<div class="lead" style="margin-top:8px">No task running.</div>' +
      '<div class="small dim" style="margin-top:4px">Find a disc and bring it to the tray.</div>' +
      powersBlock(t, true) + '</div>';
  }

  if (a.loading > 0) {
    return '<div class="grow panel">' + name +
      '<div class="pill amber" style="margin:8px 0;border-color:#d64c42;color:#d64c42">scratched disc</div>' +
      '<div style="font-size:26px;line-height:1.25;color:#fff;margin:10px 0">Loading&hellip; ' +
        '<span id="loadclock' + t + '" style="font-family:var(--mono)">' + mmss(a.loading) + '</span></div>' +
      '<div class="small dim">The task appears when it finishes loading. This time comes off the clock.</div>' +
      '<div class="row" style="margin-top:14px">' +
        '<button class="bad" onclick="post(\'abandon\',{team:\'' + t + '\'})">give up</button></div>' +
      powersBlock(t, false) + '</div>';
  }

  var tag = a.power ? 'special disc &middot; ' + esc(a.power) : esc(a.judged);
  var race = "";
  if (a.hijack_of) {
    race = '<div class="pill amber" style="margin:8px 0">hijacked from team ' + a.hijack_of.toLowerCase() + '</div>';
  } else if (a.contested) {
    race = '<div class="pill amber" style="margin:8px 0">hijacked by team ' + other.toLowerCase() +
      ' &mdash; first accepted photo wins</div>';
  }
  var pw = "";
  if (a.power && !a.hijack_of) {
    var play = a.power === "HIJACK" || a.power === "SCRATCH";
    pw = '<div class="small" style="margin:10px 0">' + esc(S.power_text[a.power]) +
      '<div class="dim" style="margin-top:4px">' +
      (play ? 'Log it and your team holds a ' + esc(a.power) + ' straight away.'
            : 'If the room accepts it at the reel, your team banks this for the end.') +
      '</div></div>';
  }

  return '<div class="grow panel">' + name +
    '<div class="small dim" style="margin-top:4px">' + tag + '</div>' + race +
    '<div style="font-size:26px;line-height:1.25;color:#fff;margin:10px 0">' + esc(a.text) + '</div>' +
    (a.author ? '<div class="byline">written by ' + esc(a.author) + '</div>' : '') + pw +
    '<div class="row" style="margin-top:14px">' +
      '<button class="primary grow" onclick="startCapture(\'' + t + '\')">done &mdash; log it</button>' +
      '<button class="bad" onclick="post(\'abandon\',{team:\'' + t + '\'})">give up</button>' +
    '</div>' + powersBlock(t, false) + '</div>';
}

function onScratchCode(input) {
  input.value = input.value.replace(/[^0-9]/g, "");
  if (input.value.length === 4) {
    var code = input.value;
    input.value = "";
    UI.scratchTeam = null;
    post("scratch_code", { code: code });
  }
}

function onHijackCode(input) {
  input.value = input.value.replace(/[^0-9]/g, "");
  if (input.value.length === 4) {
    var code = input.value;
    input.value = "";
    UI.hijackTeam = null;
    post("hijack_code", { code: code });
  }
}

function capturePanel(t) {
  var a = S.active[t];
  var shot = UI.shot
    ? '<img class="shot" src="' + UI.shot + '">'
    : '<video id="cam" autoplay playsinline muted></video>';
  var buttons = UI.shot
    ? '<button class="primary huge grow" onclick="logShot()">log it</button>' +
      '<button class="huge" onclick="UI.shot=null;render()">retake</button>'
    : '<button class="primary huge grow" onclick="snap()">take the photo</button>' +
      '<button class="huge" onclick="logShot()">skip photo</button>';

  return '<div class="card">' +
    '<div class="kicker">evidence &middot; team ' + t + '</div>' +
    '<div class="lead" style="margin:10px 0 18px">' + esc(a.text) + '</div>' +
    shot +
    '<input id="note" placeholder="a note for the reel (optional)" style="margin:14px 0">' +
    '<div class="row">' + buttons +
      '<button class="huge" onclick="stopCam();UI.capturing=false;UI.captureTeam=null;UI.shot=null;render()">back</button>' +
    '</div></div>';
}

function onClaimCode(input) {
  input.value = input.value.replace(/[^0-9]/g, "");
  if (input.value.length === 4) {
    var code = input.value;
    input.value = "";
    post("claim_code", { code: code });
  }
}

function startCapture(t) { UI.capturing = true; UI.captureTeam = t; UI.shot = null; render(); }

function startCam() {
  if (UI.stream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
    .then(function (stream) {
      UI.stream = stream;
      var v = el("cam");
      if (v) { v.srcObject = stream; } else { stopCam(); }
    }).catch(function () {});
}

function stopCam() {
  if (UI.stream) {
    UI.stream.getTracks().forEach(function (t) { t.stop(); });
    UI.stream = null;
  }
}

function snap() {
  var v = el("cam");
  if (!v || !v.videoWidth) return;
  var c = document.createElement("canvas");
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  UI.shot = c.toDataURL("image/jpeg", 0.82);
  stopCam();
  render();
}

function logShot() {
  var n = el("note");
  var note = n ? n.value : "";
  var photo = UI.shot, team = UI.captureTeam;
  stopCam();
  UI.capturing = false; UI.captureTeam = null; UI.shot = null;
  post("finish", { team: team, photo: photo, note: note });
}

/* ---- reel ---- */

function viewReel() {
  var row = S.log[S.reel_index];
  if (!row) return '<div class="card center"><div class="tasktext">Nothing was logged.</div>' +
    '<button class="primary huge" onclick="post(\'to_accusation\')">carry on</button></div>';

  var img = row.photo
    ? '<img class="shot" src="' + esc(row.photo) + '">'
    : '<div class="noshot">no photograph</div>';

  var worth = row.seconds ? worthOf(row.seconds) : 10;

  return '<div class="card">' +
    '<div class="kicker">the reel &middot; ' + (S.reel_index + 1) + ' of ' + S.log.length +
      ' &middot; team ' + row.team + ' &middot; worth ' + worth +
      (row.late ? ' &middot; late, less ' + 5 : '') +
      (row.power ? ' &middot; special disc' : '') +
      (row.race ? ' &middot; race &mdash; first accepted photo takes +5' : '') +
      (row.contest && !row.race ? ' &middot; hijacked task &mdash; first accepted photo scores' : '') + '</div>' +
    '<div class="lead" style="margin:12px 0 18px">' + esc(row.text) + '</div>' +
    img +
    (row.note ? '<div class="dim center" style="margin-bottom:14px">&ldquo;' + esc(row.note) + '&rdquo;</div>' : '') +
    (row.author ? '<div class="byline center" style="margin-bottom:14px">written by ' + esc(row.author) + '</div>' : '') +
    '<div class="hr"></div>' +
    tallyBlock() +
    '</div>';
}

/* what a task is worth, by the clock it was given - mirrors score_for() */
function worthOf(seconds) {
  if (seconds <= 120) return 10;
  if (seconds <= 180) return 15;
  return 20;
}

/* The room votes on its phones. The screen shows how many are in and nothing
   else: put names up here and the Mole is caught on the first photograph. */
function tallyBlock() {
  var v = S.vote || { yes: 0, no: 0, "in": 0, of: 0 };
  var waiting = Math.max(0, v.of - v["in"]);
  // only a real tie, once the room is all in - not a passing 1-1 on the way there
  var tied = v["in"] > 0 && v.yes === v.no && v["in"] >= v.of;

  var dots = "";
  for (var i = 0; i < v.of; i++) {
    dots += '<span class="pip' + (i < v["in"] ? ' cast' : '') + '"></span>';
  }

  var head = v.of
    ? '<div class="votehead"><div class="votecount">' + v["in"] + ' of ' + v.of + '</div>' +
      '<div class="pips">' + dots + '</div>' +
      '<div class="dim small">' + (waiting
        ? waiting + (waiting === 1 ? ' phone still deciding' : ' phones still deciding')
        : 'everybody has voted') + '</div></div>'
    : '<div class="center dim" style="margin-bottom:14px">No players registered.</div>';

  var seats = S.seated
    ? ''
    : '<div class="center small dim" style="margin-bottom:12px">Nobody has picked ' +
      'their name on a phone yet &mdash; open the phone page and tap who you are, ' +
      'or just call it here.</div>';

  var tie = tied
    ? '<div class="center" style="margin-bottom:12px;color:var(--amber)">Tied ' +
      v.yes + '&ndash;' + v.no + '. Somebody has to settle it.</div>'
    : '';

  var said = S.message
    ? '<div class="msg center">' + esc(S.message) + '</div>'
    : '';

  return head + seats + tie + said +
    '<div class="row" style="margin-top:14px">' +
      '<button class="primary grow" onclick="post(\'close_vote\')">' +
        (v["in"] ? 'close the vote' : 'close the vote') + '</button>' +
    '</div>' +
    '<div class="center small dim" style="margin:14px 0 8px">or call it at the laptop</div>' +
    '<div class="row">' +
      '<button class="good grow" onclick="post(\'judge\',{verdict:\'accept\'})">it counts</button>' +
      '<button class="bad grow" onclick="post(\'judge\',{verdict:\'reject\'})">it does not</button>' +
    '</div>';
}

/* ---- the record ---- */

function verdictWord(v) {
  return ({ accept: "counted", reject: "not counted", beaten: "beaten to it",
            vetoed: "struck out" })[v] || "not counted";
}

/* Every split vote of the night, all at once, just before the accusations.
   A unanimous vote says nothing about anybody, so it is not here. */
function viewRecord() {
  var r = S.record || { rows: [], people: [], judged: 0, split: 0 };

  var people = r.people.map(function (c) {
    var suspicious = c.against_own > 0;
    return '<div class="item">' +
      '<span class="pill">' + esc(c.name) + '</span>' +
      '<span class="flex small dim">team ' + c.team + ' &middot; voted on ' + c.voted + '</span>' +
      '<span class="small' + (suspicious ? ' warn' : ' dim') + '">' +
        c.against_own + ' against own' + '</span>' +
      '<span class="small dim">' + c.for_theirs + ' for theirs</span>' +
      '</div>';
  }).join("");

  var rows = r.rows.map(function (row) {
    return '<div class="split">' +
      '<div class="kicker">team ' + row.team + ' &middot; ' + esc(row.disc) +
        ' &middot; ' + verdictWord(row.verdict) + '</div>' +
      '<div class="small" style="margin:6px 0 10px">' + esc(row.text) + '</div>' +
      '<div class="sides">' +
        '<div><span class="side good">counts</span> ' + esc(row.yes.join(", ")) + '</div>' +
        '<div><span class="side bad">does not</span> ' + esc(row.no.join(", ")) + '</div>' +
      '</div></div>';
  }).join("");

  return '<div class="card">' +
    '<div class="kicker">the record</div>' +
    '<div class="lead" style="margin:10px 0 6px">Who stood where</div>' +
    '<div class="dim small" style="margin-bottom:18px">' + r.judged +
      ' photographs went to a vote. The room agreed on ' + (r.judged - r.split) +
      ' of them, so only the ' + r.split + ' it argued about are here. ' +
      'Honest people disagree too &mdash; this is evidence, not proof.</div>' +
    (people ? '<div class="list">' + people + '</div>' : '') +
    (rows ? '<div class="hr"></div>' + rows : '') +
    '<button class="primary huge wide" style="margin-top:18px" ' +
      'onclick="post(\'to_powers\')">on to the powers</button>' +
    '</div>';
}

/* ---- powers ---- */

function viewPowers() {
  var t = UI.powerTeam;
  var other = t === "A" ? "B" : "A";
  var mine = S.powers[t] || [];

  var held = mine.map(function (p) {
    return '<div class="item"><span class="pill amber">' + esc(p) + '</span>' +
      '<span class="flex small">' + esc(S.power_text[p]) + '</span>' +
      '<button class="primary" onclick="pickPower(\'' + p + '\')">spend</button></div>';
  }).join("") || '<div class="item dim">Team ' + t + ' banked nothing.</div>';

  var targets = "";
  if (UI.powerPick === "VETO" || UI.powerPick === "TESTIMONY") {
    var want = UI.powerPick === "VETO" ? other : t;
    var rows = S.log.filter(function (r) { return r.team === want; });
    targets = '<div class="hr"></div><h2>choose a target</h2><div class="list">' +
      (rows.map(function (r) {
        return '<div class="item"><span class="flex small">' + esc(r.text) +
          ' <span class="dim">(' + r.score + ' pts)</span></span>' +
          '<button onclick="post(\'use_power\',{team:\'' + t + '\',power:\'' + UI.powerPick +
          '\',target:' + r.id + '});UI.powerPick=null">use</button></div>';
      }).join("") || '<div class="item dim">No eligible tasks.</div>') + '</div>';
  }

  var spent = S.spent.map(function (r) {
    return '<div class="item"><span class="pill amber">' + esc(r.power) + '</span>' +
      '<span class="flex small">team ' + r.team + ' &middot; ' + esc(r.detail) + '</span></div>';
  }).join("") || '<div class="item dim">Nothing spent yet.</div>';

  return '<div class="center"><h1>POWERS</h1>' +
    '<div class="sub">everything you banked, all at once, right now</div></div>' +
    '<div class="scorebar">' +
      '<div><div class="t teamA">team a</div><div class="n">' + S.totals.A + '</div></div>' +
      '<div><div class="t teamB">team b</div><div class="n">' + S.totals.B + '</div></div>' +
    '</div>' +
    '<div class="row">' +
      '<div class="grow panel">' +
        '<div class="row" style="margin-bottom:16px">' +
          '<button class="grow' + (t === "A" ? " primary" : "") + '" onclick="UI.powerTeam=\'A\';UI.powerPick=null;render()">team a</button>' +
          '<button class="grow' + (t === "B" ? " primary" : "") + '" onclick="UI.powerTeam=\'B\';UI.powerPick=null;render()">team b</button>' +
        '</div>' +
        '<div class="list">' + held + '</div>' + targets +
        '<div class="small dim" style="margin-top:16px">Your Mole is at this table and has an ' +
        'opinion about which of these you should spend. Listen carefully.</div>' +
      '</div>' +
      '<div class="grow panel"><h2 style="margin-top:0">spent</h2>' +
        '<div class="list">' + spent + '</div>' +
        '<div style="margin-top:22px">' +
        '<button class="primary wide huge" onclick="post(\'to_accusation\')">to the accusations</button></div>' +
      '</div>' +
    '</div>';
}

function pickPower(p) {
  if (p === "VETO" || p === "TESTIMONY") { UI.powerPick = p; render(); return; }
  post("use_power", { team: UI.powerTeam, power: p });
}

/* ---- accusation ---- */

function viewAccusation() {
  function block(team) {
    var acc = S.accusations[team];
    var roster = S.players.filter(function (p) { return p.team === team; });
    if (acc && acc.confessed) {
      return '<div class="grow panel"><h2 style="margin-top:0">team ' + team + '</h2>' +
        '<div class="lead">Confession already spent.</div>' +
        '<div class="spot" style="margin-top:10px">' + esc(acc.named.join(", ") || "nobody") + '</div></div>';
    }
    if (acc) {
      return '<div class="grow panel"><h2 style="margin-top:0">team ' + team + '</h2>' +
        '<div class="dim">accused</div><div class="spot">' + esc(acc.named[0]) + '</div></div>';
    }
    return '<div class="grow panel"><h2 style="margin-top:0">team ' + team + '</h2>' +
      '<div class="small dim" style="margin-bottom:12px">Name the Mole in your own ranks.</div>' +
      '<div class="stack">' + roster.map(function (p) {
        return '<button class="wide" onclick="post(\'accuse\',{team:\'' + team + '\',name:\'' +
          esc(p.name).replace(/'/g, "\\'") + '\'})">' + esc(p.name) + '</button>';
      }).join("") + '</div></div>';
  }

  var ready = S.accusations.A && S.accusations.B;
  return '<div class="center"><h1>THE MOLE</h1>' +
    '<div class="sub">one of yours has been playing for the other side</div></div>' +
    '<div class="row">' + block("A") + block("B") + '</div>' +
    '<div class="center" style="margin-top:30px">' +
    '<button class="primary huge" ' + (ready ? "" : "disabled") +
    ' onclick="post(\'to_results\')">reveal everything</button></div>';
}

/* ---- results ---- */

function viewResults() {
  var win = S.totals.A === S.totals.B ? "a draw" :
    (S.totals.A > S.totals.B ? "team a" : "team b");

  var notes = S.notes.map(function (n) {
    return '<div class="item"><span class="flex">' + esc(n) + '</span></div>';
  }).join("");

  var tasks = S.log.map(function (r) {
    return '<div class="item"><span class="pill' + (r.score ? " amber" : "") + '">' + r.score + '</span>' +
      '<span class="flex small">team ' + r.team + ' &middot; ' + esc(r.text) + '</span></div>';
  }).join("");

  return '<div class="center"><h1>' + win.toUpperCase() + '</h1>' +
    '<div class="sub">final</div></div>' +
    '<div class="scorebar">' +
      '<div><div class="t teamA">team a</div><div class="n">' + S.totals.A + '</div></div>' +
      '<div><div class="t teamB">team b</div><div class="n">' + S.totals.B + '</div></div>' +
    '</div>' +
    '<div class="row">' +
      '<div class="grow panel"><h2 style="margin-top:0">the moles</h2>' +
        '<div class="list">' + (notes || '<div class="item dim">No moles in play.</div>') + '</div>' +
      '</div>' +
      '<div class="grow panel"><h2 style="margin-top:0">the reel</h2>' +
        '<div class="list">' + (tasks || '<div class="item dim">Nothing logged.</div>') + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="center" style="margin-top:30px">' +
    '<button class="huge" onclick="if(confirm(\'New game? The collection and your tasks are kept.\')){UI.draftPlayers=[];post(\'reset\')}">' +
    'play again</button></div>';
}

// ---------------------------------------------------------------- boot

poll();
setInterval(poll, 1000);
setInterval(tick, 250);
