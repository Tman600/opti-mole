/* OPTI-MOLE - the phone side.
   Joins with a team passcode, claims the tray, and carries the camera. */

var TOKEN = null;
try { TOKEN = localStorage.getItem("optimole.token"); } catch (e) {}

var P = null;                 // last phone snapshot
var CLOCK = { game: 0, task: null, at: 0 };
var V = { err: "", shot: null, note: "", busy: false, sig: null };

// ---------------------------------------------------------------- plumbing

function post(body) {
  return fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); });
}

function poll() {
  if (!TOKEN) { draw(); return; }
  fetch("/api/phone/state?token=" + encodeURIComponent(TOKEN))
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j.ok) { signOut(); return; }
      P = j;
      CLOCK.game = j.clock;
      CLOCK.task = j.mine ? j.mine.left : null;
      CLOCK.load = j.mine ? j.mine.loading : 0;
      CLOCK.theirs = j.theirs ? j.theirs.left : null;
      CLOCK.at = Date.now();
      draw();
    })
    .catch(function () {});
}

function signOut() {
  TOKEN = null; P = null;
  try { localStorage.removeItem("optimole.token"); } catch (e) {}
  draw();
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

// ---------------------------------------------------------------- clock

function tick() {
  var bar = el("clock"), who = el("who");
  if (!P) { document.body.className = "bare"; return; }
  document.body.className = "";

  var drift = (Date.now() - CLOCK.at) / 1000;
  var game = Math.max(0, CLOCK.game - drift);
  var task = CLOCK.task === null || CLOCK.task === undefined ? null : Math.max(0, CLOCK.task - drift);

  // the bar shows your own task clock while you have one, otherwise the game clock
  if (task !== null) {
    bar.textContent = mmss(task);
    bar.className = "task" + (task <= 15 ? " urgent" : "");
  } else {
    bar.textContent = mmss(game);
    bar.className = game <= 60 ? "urgent" : "";
  }
  who.textContent = "team " + P.team + "  ·  " + P.totals[P.team] + " pts";

  var myload = el("myload");
  if (myload && P.mine) myload.textContent = mmss(Math.max(0, (CLOCK.load || 0) - drift));

  var theirs = el("theirsclock");
  if (theirs && CLOCK.theirs !== null && CLOCK.theirs !== undefined) {
    theirs.textContent = mmss(Math.max(0, CLOCK.theirs - drift));
  }
}

// ---------------------------------------------------------------- screens

function draw() {
  tick();
  // Do not rebuild while someone is mid-typing or the keyboard closes on them.
  var sig = JSON.stringify([
    !!TOKEN, P && P.phase, P && P.pending,
    P && P.mine && [P.mine.text, P.mine.hijack_of, P.mine.contested, P.mine.loading > 0],
    P && P.scratches, P && P.can_scratch, P && P.slowed, P && P.they_slowed,
    P && P.theirs && [P.theirs.text, P.theirs.hijack_of, P.theirs.contested],
    P && P.hijacks, P && P.can_hijack,
    P && P.lead, P && P.discs_left, P && P.totals, V.err, V.shot ? V.shot.length : 0, V.busy
  ]);
  if (sig === V.sig) return;
  V.sig = sig;

  // background cast: the phase, plus whether this task is ours or scratched
  var b = document.body;
  b.dataset.phase = P ? P.phase : "";
  b.dataset.mine = P && P.mine ? "1" : "0";
  b.dataset.slowed = P && P.slowed ? "1" : "0";
  // animate only when the screen itself changes, not on every poll
  var kind = [!!TOKEN, P && P.phase, !!(P && P.mine), !!(P && P.pending), !!V.shot,
              !!(P && P.mine && P.mine.loading)].join("|");
  var changed = kind !== V.kind;
  V.kind = kind;

  var live = document.activeElement;
  var liveId = live && live.id ? live.id : null;
  var liveVal = live && "value" in live ? live.value : null;

  el("stage").innerHTML = TOKEN && P ? screenGame() : screenJoin();

  if (changed) {
    var st = el("stage");
    st.classList.remove("enter");
    void st.offsetWidth;
    st.classList.add("enter");
  }

  if (liveId) {
    var back = el(liveId);
    if (back) { if (liveVal !== null) back.value = liveVal; back.focus(); }
  }
}

/* ---- join ---- */

function screenJoin() {
  return '' +
  '<h1 class="brand"><span class="opti">OPTI-</span><span class="mole">MOLE</span></h1>' +
  '<div class="sub">phone</div>' +
  '<div class="panel">' +
    '<div class="kicker">team passcode</div>' +
    '<div class="small dim" style="margin-bottom:14px">Four digits. It was on the ' +
    'laptop when you read your role.</div>' +
    '<input id="code" type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="4" ' +
      'placeholder="0000" oninput="onCode(this)">' +
    '<div class="err">' + esc(V.err) + '</div>' +
  '</div>' +
  '<button class="primary go" onclick="joinNow()">join</button>' +
  '<div class="small dim center">One phone per person is fine. ' +
  'Everyone on a team sees the same task.</div>';
}

function onCode(input) {
  input.value = input.value.replace(/[^0-9]/g, "");
  if (input.value.length === 4) joinNow();
}

function joinNow() {
  var box = el("code");
  var code = box ? box.value.trim() : "";
  if (code.length !== 4) { V.err = "Four digits."; V.sig = null; draw(); return; }
  post({ action: "phone_join", code: code }).then(function (j) {
    if (!j.ok) {
      V.err = j.error || "No.";
      if (box) box.value = "";
      V.sig = null; draw();
      return;
    }
    TOKEN = j.token;
    try { localStorage.setItem("optimole.token", TOKEN); } catch (e) {}
    V.err = ""; V.sig = null;
    poll();
  });
}

/* ---- in game ---- */

function screenGame() {
  if (P.phase !== "play") return screenWaiting();
  if (P.mine) return V.shot ? screenReview() : screenTask();
  // No task of our own: the other team being busy never stops us any more.
  if (P.pending) return screenClaim();
  return screenHunt();
}

/* SCRATCH works whether or not you're busy, so it rides along on every play screen */
function scratchPanel() {
  var other = P.team === "A" ? "B" : "A";
  var out = "";
  if (P.slowed) {
    out += '<div class="panel" style="border-color:#6b2e2a">' +
      '<div class="kicker" style="color:#d64c42">you have been scratched</div>' +
      '<div class="small">Team ' + other + ' scratched your next disc. When you claim it, it loads for ' +
      'a while before its task appears, and that time comes off your clock.</div></div>';
  }
  if (P.can_scratch) {
    out += '<div class="panel"><button class="primary" style="margin:0 0 8px" onclick="scratch()">' +
      'scratch team ' + other + '\'s next disc</button>' +
      '<div class="small dim">Their next disc loads slowly before its task appears.</div></div>';
  } else if (P.scratches) {
    out += '<div class="small center" style="margin:0 0 14px;color:var(--amber)">You hold a SCRATCH ' +
      '&mdash; Team ' + other + '\'s next disc is already scratched.</div>';
  }
  return out;
}

/* what the other team is up to, and the HIJACK button when it can be used */
function otherTeamPanel() {
  var t = P.theirs;
  var other = P.team === "A" ? "B" : "A";
  var hj = "";
  if (P.can_hijack) {
    hj = '<button class="primary" style="margin:14px 0 0" onclick="hijack()">hijack this task</button>' +
      '<div class="small dim">Your team joins it on their clock. Both of you can log it; ' +
      'the first photo the room accepts takes the points.</div>';
  } else if (P.hijacks) {
    hj = '<div class="small" style="margin-top:10px;color:var(--amber)">You hold a HIJACK' +
      (t ? ' &mdash; not usable on this one.' : ' &mdash; usable once Team ' + other + ' starts a task.') + '</div>';
  }
  if (!t) {
    return hj ? '<div class="panel">' + hj + '</div>' : '';
  }
  return '<div class="panel">' +
    '<div class="kicker">team ' + other + ' is doing &middot; <span id="theirsclock">' + mmss(t.left) + '</span></div>' +
    '<div style="font-size:19px;line-height:1.3;color:#fff">' + esc(t.text) + '</div>' +
    (t.hijack_of ? '<div class="small dim" style="margin-top:6px">hijacked from you &mdash; first accepted photo wins</div>' : '') +
    hj + '</div>';
}

function screenWaiting() {
  var text = {
    setup: "Waiting for the laptop.",
    hiding: "Go and hide your discs.",
    briefing: "Roles are being read.",
    reel: "Everyone back to the laptop. The reel is playing.",
    powers: "Powers are being spent.",
    accusation: "Name the mole.",
    results: "It is over."
  }[P.phase] || "Waiting.";

  return '<div class="panel center">' +
    '<span class="teamtag">team ' + P.team + '</span>' +
    '<div class="big" style="margin-top:18px">' + esc(text) + '</div>' +
    '</div>' + footer();
}

function screenHunt() {
  return '' +
  '<div class="panel">' +
    '<div class="kicker">your lead</div>' +
    '<div class="spot">' + esc(P.lead || "nothing left to find") + '</div>' +
  '</div>' +
  '<div class="panel center">' +
    '<div class="big">Find a disc.<br>Take it to the tray.</div>' +
    '<div class="small dim" style="margin-top:12px">' + P.discs_left + ' of ' +
    P.discs_total + ' still hidden</div>' +
  '</div>' + otherTeamPanel() + scratchPanel() + footer();
}

function screenClaim() {
  return '' +
  '<div class="panel center">' +
    '<div class="kicker">in the tray</div>' +
    '<div class="task">' + esc(P.pending) + '</div>' +
    '<div class="small dim">First team to claim it gets the task. ' +
    'You are signed in as Team ' + P.team + '.</div>' +
  '</div>' +
  '<button class="primary go" onclick="claim()">claim for team ' + P.team + '</button>' +
  scratchPanel() + footer();
}

function screenTask() {
  var a = P.mine;
  if (a.loading > 0) {
    return '' +
    '<div class="panel center" style="border-color:#6b2e2a">' +
      '<div class="kicker" style="color:#d64c42">scratched disc</div>' +
      '<div class="task">Loading&hellip;<br><span id="myload" style="font-family:var(--mono)">' +
        mmss(a.loading) + '</span></div>' +
      '<div class="small dim">The other team scratched this disc. Your task appears when it ' +
      'finishes loading, and this time comes off your clock.</div>' +
    '</div>' +
    '<button class="bad" onclick="giveUp()">give up</button>' + scratchPanel();
  }
  var power = "";
  if (a.power && !a.hijack_of) {
    power = '<div class="panel"><span class="teamtag">' + esc(a.power) + '</span>' +
      '<div class="small dim" style="margin-top:10px">' +
      (a.power === "HIJACK"
        ? 'Special disc. Log it and your team holds a HIJACK straight away &mdash; use it on the other team\'s next task.'
        : a.power === "SCRATCH"
        ? 'Special disc. Log it and your team holds a SCRATCH straight away &mdash; use it to slow the other team\'s next disc.'
        : 'Special disc. If the room accepts it at the reel, your team banks this for the very end.') +
      '</div></div>';
  }
  var race = "";
  if (a.hijack_of) {
    race = '<div class="small" style="margin-top:8px;color:var(--amber)">Hijacked from Team ' + a.hijack_of +
      '. Beat them to it &mdash; the first photo the room accepts wins.</div>';
  } else if (a.contested) {
    race = '<div class="small" style="margin-top:8px;color:var(--amber)">The other team hijacked this. ' +
      'The first photo the room accepts wins.</div>';
  }
  return '' +
  '<div class="panel">' +
    '<div class="kicker">team ' + a.team + ' &middot; ' + esc(a.judged) + '</div>' +
    '<div class="task">' + esc(a.text) + '</div>' + race +
    (a.author ? '<div class="byline">written by ' + esc(a.author) + '</div>' : '') +
  '</div>' + power +
  '<button class="primary go" onclick="shoot()">take the photo</button>' +
  '<div class="rowsplit">' +
    '<button onclick="logIt(true)">log with no photo</button>' +
    '<button class="bad" onclick="giveUp()">give up</button>' +
  '</div>' + scratchPanel();
}

function screenReview() {
  return '' +
  '<img class="shot" src="' + V.shot + '">' +
  '<label>a note for the reel</label>' +
  '<input id="note" type="text" placeholder="optional" value="' + esc(V.note) + '" ' +
    'oninput="V.note=this.value">' +
  '<div style="height:16px"></div>' +
  '<button class="primary go" ' + (V.busy ? "disabled" : "") + ' onclick="logIt(false)">' +
    (V.busy ? "sending" : "log it") + '</button>' +
  '<div class="rowsplit">' +
    '<button onclick="shoot()">retake</button>' +
    '<button onclick="V.shot=null;V.sig=null;draw()">back</button>' +
  '</div>';
}

function footer() {
  return '<div class="hr"></div>' +
    '<div class="center small dim">team ' + P.team + ' &middot; code ' + esc(P.code) +
    ' &middot; ' + P.logged + ' logged</div>';
}

/* ---- actions ---- */

function claim() {
  post({ action: "phone_claim", token: TOKEN }).then(function (j) {
    if (j.ok) { P = j; V.sig = null; draw(); }
  });
}

function hijack() {
  post({ action: "phone_hijack", token: TOKEN }).then(function (j) {
    if (j.ok) { P = j; CLOCK.task = j.mine ? j.mine.left : null; CLOCK.at = Date.now(); V.sig = null; draw(); }
  });
}

function scratch() {
  post({ action: "phone_scratch", token: TOKEN }).then(function (j) {
    if (j.ok) { P = j; V.sig = null; draw(); }
  });
}

function giveUp() {
  post({ action: "phone_abandon", token: TOKEN }).then(function (j) {
    if (j.ok) { P = j; V.shot = null; V.note = ""; V.sig = null; draw(); }
  });
}

function shoot() { el("shutter").click(); }

el("shutter").addEventListener("change", function (ev) {
  var file = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  shrink(file, function (dataUrl) {
    V.shot = dataUrl; V.sig = null; draw();
  });
});

/* A phone photo is 3-6 MB. This server is the Python standard library and the
   reel only ever shows these at screen size, so resize before it leaves here. */
function shrink(file, done) {
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      var max = 1400;
      var w = img.width, h = img.height;
      if (w > max || h > max) {
        var k = Math.min(max / w, max / h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      done(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = function () { done(reader.result); };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function logIt(skipPhoto) {
  if (V.busy) return;
  V.busy = true; V.sig = null; draw();
  post({
    action: "phone_finish",
    token: TOKEN,
    photo: skipPhoto ? null : V.shot,
    note: V.note
  }).then(function (j) {
    V.busy = false; V.shot = null; V.note = ""; V.sig = null;
    if (j.ok) P = j;
    draw();
  }).catch(function () {
    V.busy = false; V.err = "Send failed. Try again."; V.sig = null; draw();
  });
}

// ---------------------------------------------------------------- boot

draw();
poll();
setInterval(poll, 1000);
setInterval(tick, 250);
