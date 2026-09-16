"""
OPTI-MOLE - a party game that runs on a DVD drive.

Start it with:   python server.py
Then open:       http://localhost:7321

Windows: reads real discs out of the optical drive.
Anywhere else (or with no drive): use SIMULATOR mode in the UI.
"""

import base64
import ctypes
import hashlib
import http.server
import json
import os
import random
import socket
import socketserver
import threading
import time
import urllib.parse

APP_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(APP_DIR, "web")
DATA_DIR = os.path.join(APP_DIR, "data")
PHOTO_DIR = os.path.join(DATA_DIR, "photos")
COLLECTION_FILE = os.path.join(DATA_DIR, "collection.json")
CUSTOM_FILE = os.path.join(DATA_DIR, "custom_tasks.json")

PORT = 7321

# ---------------------------------------------------------------- content

SPOTS = [
    "in a room with a sink",
    "above head height",
    "somewhere cold",
    "under something heavy",
    "behind a door",
    "in the room where people eat",
    "touching something made of glass",
    "below knee height",
    "in the darkest room",
    "next to something that makes noise",
    "in a room with no windows",
    "inside something that closes",
    "on a surface people put drinks on",
    "within reach of a light switch",
    "in the room furthest from the front door",
    "somewhere you would have to move something to see it",
    "beside something soft",
    "in a room with a mirror",
    "under a seat",
    "next to something with a plug",
    "on top of a book",
    "in the room with the most chairs",
    "somewhere a guest would never look",
    "touching a wall that faces the street",
]

# judged: "vote" (room decides), "race" (first team back), "pass" (did it or not)
DEFAULT_TASKS = [
    ["Bring back something older than everyone in this room.", 120, "vote"],
    ["Bring back the ugliest object in this house.", 120, "vote"],
    ["Photograph your entire team touching the same doorframe.", 90, "pass"],
    ["Bring back three objects that are the same colour.", 120, "pass"],
    ["Find something in this house that nobody present can identify.", 150, "vote"],
    ["Photograph your whole team fitting inside one doorway.", 90, "pass"],
    ["Bring back the heaviest thing one person can carry alone.", 120, "vote"],
    ["Bring back something with a stranger's handwriting on it.", 150, "vote"],
    ["Bring back an object that has been in this house longer than you have.", 120, "vote"],
    ["Find two objects that look identical but are not.", 150, "vote"],
    ["Bring back something that is broken and nobody has thrown away.", 120, "vote"],
    ["Photograph your team recreating a picture already hanging in this house.", 180, "vote"],
    ["Bring back the smallest object you can find that has a screw in it.", 120, "vote"],
    ["Bring back something from the room nobody has entered tonight.", 120, "pass"],
    ["Build a stack of five objects that stands unaided. Photograph it.", 150, "pass"],
    ["Bring back something that smells strongly. Do not open it.", 120, "vote"],
    ["Photograph every member of your team holding a different vegetable.", 150, "pass"],
    ["Bring back the oldest piece of paper in this house.", 150, "vote"],
    ["Find an object whose purpose the owner of this house cannot explain.", 150, "vote"],
    ["Race: first team to photograph a full set of cutlery, fanned out.", 90, "race"],
    ["Race: first team to photograph all members touching the front door at once.", 90, "race"],
    ["Race: first team back with a shoe belonging to someone not on your team.", 90, "race"],
    ["Race: first team to photograph a working clock and a stopped one together.", 120, "race"],
    ["Bring back something that would be embarrassing to explain.", 150, "vote"],
    ["Photograph your team in a room, all facing the wall.", 90, "pass"],
    ["Bring back two objects that fit perfectly inside each other.", 150, "vote"],
    ["Find the dustiest object in this house.", 120, "vote"],
    ["Bring back something printed with a date from before you were born.", 150, "vote"],
    ["Photograph the view from the highest window you can reach.", 120, "pass"],
    ["Bring back an object that three different people have touched today.", 120, "vote"],
]

# Special discs. Only SPECIALS_PER_GAME of these are live in any one game - the
# computer picks them, and a host may swap them on their private turn.
# These five bank a power for the endgame, if the room accepts them at the reel.
SPECIAL_TASKS = [
    ["CONFESSION",
     "Every member of your team, barefoot, standing on furniture in three different rooms. One photo per room.",
     240],
    ["VETO",
     "Bring back one object from the highest point in this house and one from the lowest. Photograph them together.",
     180],
    ["TESTIMONY",
     "Build a tower at least as tall as your shortest player out of objects you did not bring into this house today.",
     300],
    ["SHIELD",
     "Photograph every member of your team holding a different appliance that is plugged in and switched on.",
     240],
    ["LONG COUNT",
     "Find five objects with writing on them, in five different rooms. One photo, all five together.",
     240],
]

# These two are used DURING play, so they cannot wait for the reel to be banked -
# a team holds one the moment its task is logged.
PLAY_TASKS = [
    ["HIJACK",
     "Bring back four objects from four different rooms that are all the same colour. "
     "Photograph them together.",
     180],
    ["SCRATCH",
     "Bring back five things that make a different sound when you drop them. "
     "Photograph them in a row.",
     180],
]
PLAY_POWERS = set(t[0] for t in PLAY_TASKS)
ALL_SPECIALS = SPECIAL_TASKS + PLAY_TASKS
SPECIALS_PER_GAME = 3
SCRATCH_SECONDS = 45        # how long a scratched disc "loads" before its task appears

POWER_TEXT = {
    "HIJACK": "During play: join the other team's running task. Both teams can log it - "
              "the first photo the room accepts at the reel takes the points.",
    "SCRATCH": "During play: the other team's next disc is scratched. It loads for %d seconds "
               "before its task appears, and that time comes off their clock." % SCRATCH_SECONDS,
    "CONFESSION": "The app names the Mole hiding in your team, out loud.",
    "VETO": "Strike one of the other team's logged tasks. It scores zero.",
    "TESTIMONY": "One of your rejected tasks scores anyway.",
    "SHIELD": "Your team's Mole guess counts for nothing either way - no points won or lost.",
    "LONG COUNT": "Double your single best-scoring task.",
}

SCORE_TASK = 10             # the floor: a short task
SCORE_RACE_BONUS = 5
SCORE_ACCUSE = 25
SCORE_MOLE_SURVIVES = 25
SCORE_LATE = 5              # docked for logging after the task clock ran out

# A five minute ordeal used to be worth exactly what a ninety second photograph
# was worth, so there was no reason to take the hard disc. Pay by the clock.
SCORE_STEPS = [(120, 10), (180, 15)]
SCORE_LONG = 20


def score_for(seconds):
    """What a task is worth, by how long it was given."""
    try:
        seconds = int(seconds)
    except (TypeError, ValueError):
        return SCORE_TASK
    for limit, points in SCORE_STEPS:
        if seconds <= limit:
            return points
    return SCORE_LONG


def lan_ip():
    """The address phones on the house wifi can actually reach."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))      # no packets are sent; this just picks a route
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()

# ---------------------------------------------------------------- disc reading

DRIVE_CDROM = 5
SEM_FAILCRITICALERRORS = 0x0001


def optical_drives():
    if os.name != "nt":
        return []
    k = ctypes.windll.kernel32
    mask = k.GetLogicalDrives()
    found = []
    for i in range(26):
        if mask & (1 << i):
            root = chr(65 + i) + ":\\"
            if k.GetDriveTypeW(ctypes.c_wchar_p(root)) == DRIVE_CDROM:
                found.append(root)
    return found


ERROR_INVALID_FUNCTION = 1
ERROR_NOT_READY = 21            # empty tray, or still spinning up
ERROR_UNRECOGNIZED_VOLUME = 1785


def probe(root):
    """Cheap: is there a disc, and what is its label + volume serial?

    This runs on a loop, so it must never touch the file system - a full
    directory walk every second keeps the drive spinning all night.

    Returns ("ok", label, serial) | ("empty", None, None) | ("blank", err, None).

    "blank" is the important one. A disc with no file system - a blank DVD-R,
    an audio CD, a disc the drive cannot read - is physically in the tray but
    Windows will not give it a volume, so there is nothing to fingerprint.
    Without this branch that disc just silently does nothing.
    """
    k = ctypes.windll.kernel32
    name = ctypes.create_unicode_buffer(261)
    fsname = ctypes.create_unicode_buffer(261)
    serial = ctypes.c_ulong()
    maxlen = ctypes.c_ulong()
    flags = ctypes.c_ulong()
    old = k.SetErrorMode(SEM_FAILCRITICALERRORS)
    try:
        ok = k.GetVolumeInformationW(
            ctypes.c_wchar_p(root), name, 260,
            ctypes.byref(serial), ctypes.byref(maxlen), ctypes.byref(flags),
            fsname, 260)
        err = k.GetLastError()
    except Exception:
        ok, err = 0, ERROR_NOT_READY
    finally:
        k.SetErrorMode(old)

    if ok:
        return ("ok", (name.value or "").strip() or "UNTITLED", serial.value)
    if err == ERROR_NOT_READY:
        return ("empty", None, None)
    return ("blank", err, None)


def fingerprint(root, label, serial):
    """Expensive: label + volume serial + a hash of the file table.

    Only ever called once, on the transition from empty tray to disc. Two
    different films never have the same VIDEO_TS structure, which is what
    saves us from the discs that all ship with a generic volume label.
    """
    h = hashlib.sha1()
    h.update(label.encode("utf-8", "ignore"))
    h.update(str(serial).encode())
    seen = 0
    try:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames.sort()
            filenames.sort()
            h.update(os.path.relpath(dirpath, root).encode("utf-8", "ignore"))
            for fn in filenames:
                try:
                    size = os.path.getsize(os.path.join(dirpath, fn))
                except OSError:
                    size = -1
                h.update(fn.encode("utf-8", "ignore"))
                h.update(str(size).encode())
                seen += 1
                if seen > 3000:
                    raise StopIteration
    except (StopIteration, OSError):
        pass
    return h.hexdigest()[:16]


class DiscWatcher(threading.Thread):
    """Polls the optical drives and reports insert / eject transitions."""

    daemon = True

    def __init__(self, game):
        threading.Thread.__init__(self)
        self.game = game
        self.present = {}

    def run(self):
        drives = optical_drives()
        if drives:
            print("[opti-mole] watching drives: " + ", ".join(drives), flush=True)
        else:
            print("[opti-mole] no optical drive found - use SIMULATOR mode in the UI", flush=True)
        while True:
            try:
                for root in optical_drives():
                    now = probe(root)
                    was = self.present.get(root)
                    if now == was:
                        continue          # nothing changed: do not touch the disc
                    self.present[root] = now
                    state, a, b = now
                    if state == "empty":
                        self.game.on_eject()
                    elif state == "blank":
                        self.game.on_unreadable(root, a)
                    else:
                        self.game.on_insert(fingerprint(root, a, b), a)
            except Exception as exc:
                print("[opti-mole] watcher error: %s" % exc)
            time.sleep(1.2)


# ---------------------------------------------------------------- persistence

def save_photo(raw):
    """Takes a data: URL from a laptop webcam or a phone camera roll."""
    if not raw or "," not in raw:
        return None
    try:
        os.makedirs(PHOTO_DIR, exist_ok=True)
        fname = "shot_%d_%d.jpg" % (int(time.time()), random.randint(100, 999))
        with open(os.path.join(PHOTO_DIR, fname), "wb") as fh:
            fh.write(base64.b64decode(raw.split(",", 1)[1]))
        return "/photos/" + fname
    except Exception:
        return None


def load_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return fallback


def save_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(value, fh, indent=2)
    os.replace(tmp, path)


# ---------------------------------------------------------------- the game

class Game(object):

    def __init__(self):
        self.lock = threading.RLock()
        self.collection = load_json(COLLECTION_FILE, [])
        self.custom = load_json(CUSTOM_FILE, [])
        self.reset_soft()

    # -- lifecycle ------------------------------------------------

    def reset_soft(self):
        self.phase = "setup"
        self.players = []
        self.length = 45 * 60
        self.started_at = None
        self.deck = {}
        self.order = []
        self.log = []
        self.powers = {"A": [], "B": []}
        self.spent = []
        self.accusations = {}
        self.reel_index = 0
        self.votes = {}          # log row id -> {player name: True/False}
        self.voters = {}         # phone token -> the player holding that phone
        self.tray = None
        self.pending = None
        # One running task per TEAM. It used to be one for the whole house, which
        # left the other team standing at a locked tray for minutes at a time.
        self.active = {"A": None, "B": None}
        self.hijacks = {"A": 0, "B": 0}
        self.scratches = {"A": 0, "B": 0}   # SCRATCH powers held
        self.slowed = {"A": False, "B": False}  # next disc this team claims is scratched
        self.message = ""
        self.host = None        # optional non-player who hides the special discs
        self.single_mole = False
        self.codes = {}          # team -> 4 digit passcode, made fresh each game
        self.tokens = {}         # phone token -> team
        self.seen = {}           # phone token -> last contact, for the phone count
        self.sim = (os.name != "nt") or (not optical_drives())

    # -- phones ---------------------------------------------------

    def new_codes(self):
        a = "%04d" % random.randint(1000, 9999)
        b = a
        while b == a:
            b = "%04d" % random.randint(1000, 9999)
        self.codes = {"A": a, "B": b}
        self.tokens = {}
        self.seen = {}
        self.voters = {}

    def join(self, code):
        """A phone trades the team passcode for a token. Returns (token, team)."""
        code = (code or "").strip()
        for team, real in self.codes.items():
            if code == real:
                token = hashlib.sha1(os.urandom(16)).hexdigest()[:20]
                self.tokens[token] = team
                self.seen[token] = time.time()
                return token, team
        return None, None

    def team_of(self, token):
        team = self.tokens.get(token or "")
        if team:
            self.seen[token] = time.time()
        return team

    def phone_count(self, team):
        now = time.time()
        return sum(1 for t, when in self.seen.items()
                   if self.tokens.get(t) == team and now - when < 25)

    def phone_state(self, token):
        """A trimmed snapshot. A phone never learns anything its team should not know."""
        team = self.team_of(token)
        if not team:
            return {"ok": False}
        with self.lock:
            other = "B" if team == "A" else "A"
            totals = {"A": 0, "B": 0}
            for row in self.log:
                totals[row["team"]] += row["score"]
            return {
                "ok": True,
                "team": team,
                "code": self.codes.get(team),
                "phase": self.phase,
                "clock": self.remaining(),
                "pending": self.deck[self.pending]["name"] if self.pending else None,
                "mine": self.task_view(team),
                "theirs": self.task_view(other),
                "hijacks": self.hijacks.get(team, 0),
                "can_hijack": self.can_hijack(team),
                "scratches": self.scratches.get(team, 0),
                "can_scratch": self.can_scratch(team),
                "slowed": self.slowed.get(team, False),         # our next disc is scratched
                "they_slowed": self.slowed.get(other, False),   # theirs is
                "lead": self.leads().get(team) if self.phase == "play" else None,
                "discs_left": sum(1 for fp in self.order if not self.deck[fp]["claimed_by"]),
                "discs_total": len(self.order),
                "totals": totals,
                "logged": sum(1 for r in self.log if r["team"] == team),
                "me": self.voters.get(token or ""),
                "roster": [p["name"] for p in self.players if p["team"] == team],
                # names already in somebody's hand, so a second phone does not
                # offer them and then refuse
                "taken": [n for t, n in self.voters.items()
                          if t != token and self.tokens.get(t) == team],
                "reel": self.reel_for_phone(token),
            }

    def reel_for_phone(self, token):
        """What a phone needs to vote: the photograph the room is looking at, and
        this player's own vote on it. Never anybody else's."""
        if self.phase != "reel" or self.reel_index >= len(self.log):
            return None
        row = self.log[self.reel_index]
        name = self.voters.get(token or "")
        v = self.votes.get(row["id"]) or {}
        c = self.vote_count(row["id"])
        return {
            "i": self.reel_index,
            "of": len(self.log),
            "id": row["id"],
            "team": row["team"],
            "disc": row["disc"],
            "text": row["text"],
            "photo": row["photo"],
            "note": row["note"],
            "late": row["late"],
            "power": row["power"],
            "race": bool(row.get("race")),
            "hijack_of": row.get("hijack_of"),
            "worth": score_for(row.get("seconds")),
            "mine": v.get(name) if name in v else None,
            "in": c["in"],
            "expected": c["of"],
        }

    # -- setup ----------------------------------------------------

    def register(self, fingerprint, label):
        for d in self.collection:
            if d["fingerprint"] == fingerprint:
                return False
        self.collection.append({"fingerprint": fingerprint, "label": label, "name": label})
        save_json(COLLECTION_FILE, self.collection)
        return True

    def rename_disc(self, fingerprint, name):
        for d in self.collection:
            if d["fingerprint"] == fingerprint:
                d["name"] = name
        save_json(COLLECTION_FILE, self.collection)

    def forget_collection(self):
        self.collection = []
        save_json(COLLECTION_FILE, self.collection)

    def task_pool(self):
        pool = [{"text": t[0], "seconds": t[1], "judged": t[2], "author": None}
                for t in DEFAULT_TASKS]
        for c in self.custom:
            pool.append({"text": c["text"], "seconds": int(c["seconds"]),
                         "judged": c["judged"], "author": c.get("author") or "house rules"})
        return pool

    def add_custom(self, text, seconds, judged, author):
        self.custom.append({"text": text, "seconds": int(seconds),
                            "judged": judged, "author": author})
        save_json(CUSTOM_FILE, self.custom)

    def delete_custom(self, index):
        if 0 <= index < len(self.custom):
            self.custom.pop(index)
            save_json(CUSTOM_FILE, self.custom)

    def start(self, players, length_minutes, single_mole, host=None):
        if len(self.collection) < 8:
            self.message = "Register at least 8 discs first."
            return False
        if len(players) < 4:
            self.message = "Need at least 4 players."
            return False
        def norm(name):
            return " ".join((name or "").split()).lower()

        # Names are how roles, hiding duty and accusations find a person, so they
        # must be unique. The home screen stops this too; this is the backstop.
        names = [norm(p.get("name")) for p in players]
        if "" in names:
            self.message = "Every player needs a name."
            return False
        dupes = sorted(set(n for n in names if names.count(n) > 1))
        if dupes:
            self.message = "Two players can't share a name: %s." % ", ".join(dupes)
            return False
        host = " ".join((host or "").split()) or None
        if host and norm(host) in names:
            # the host knows where the special discs are, so the host cannot play
            self.message = "The host can't also be a player."
            return False
        self.host = host
        self.single_mole = bool(single_mole)

        self.players = [{"name": p["name"], "team": p["team"], "mole_for": None}
                        for p in players]
        self.length = int(length_minutes) * 60

        chosen = list(self.collection)
        random.shuffle(chosen)
        chosen = chosen[:20]

        # the computer's pick; a host can swap these on their turn (set_specials)
        specials = random.sample(ALL_SPECIALS, SPECIALS_PER_GAME)

        regular = self.task_pool()
        random.shuffle(regular)
        spots = list(SPOTS)
        random.shuffle(spots)

        self.deck = {}
        self.order = []
        special_slots = random.sample(range(len(chosen)), len(specials))
        ri = 0
        for i, disc in enumerate(chosen):
            fp = disc["fingerprint"]
            self.order.append(fp)
            if i in special_slots:
                power, text, seconds = specials[special_slots.index(i)]
                task = {"text": text, "seconds": seconds, "judged": "pass",
                        "author": None, "power": power}
            else:
                t = regular[ri % len(regular)]
                ri += 1
                task = dict(t)
                task["power"] = None
            self.deck[fp] = {
                "fingerprint": fp,
                "name": disc.get("name") or disc["label"],
                "spot": spots[i % len(spots)],
                "task": task,
                "claimed_by": None,
                "hider": None,
            }

        # Hand out hiding duty so no single person knows the whole map. With a
        # host, the host hides the special discs and players only hide the rest.
        fps = list(self.deck.keys())
        random.shuffle(fps)
        if self.host:
            for fp in fps:
                if self.deck[fp]["task"]["power"]:
                    self.deck[fp]["hider"] = self.host
            fps = [fp for fp in fps if not self.deck[fp]["task"]["power"]]
        for i, fp in enumerate(fps):
            self.deck[fp]["hider"] = self.players[i % len(self.players)]["name"]

        a = [p for p in self.players if p["team"] == "A"]
        b = [p for p in self.players if p["team"] == "B"]
        if a and b:
            if single_mole:
                victim = random.choice(self.players)
                victim["mole_for"] = "B" if victim["team"] == "A" else "A"
            else:
                random.choice(a)["mole_for"] = "B"
                random.choice(b)["mole_for"] = "A"

        self.log = []
        self.powers = {"A": [], "B": []}
        self.spent = []
        self.accusations = {}
        self.reel_index = 0
        self.votes = {}
        self.voters = {}
        self.active = {"A": None, "B": None}
        self.hijacks = {"A": 0, "B": 0}
        self.scratches = {"A": 0, "B": 0}   # SCRATCH powers held
        self.slowed = {"A": False, "B": False}  # next disc this team claims is scratched
        self.pending = None
        self.new_codes()
        self.phase = "hiding"
        self.message = ""
        print("[opti-mole] team codes  A=%s  B=%s   phones: http://%s:%d/phone"
              % (self.codes["A"], self.codes["B"], lan_ip(), PORT), flush=True)
        return True

    def host_brief(self):
        """Private: what the host needs, shown only on the host's turn with the laptop."""
        if not self.host or self.phase != "hiding":
            return None
        specials = []
        for fp in self.order:
            d = self.deck[fp]
            if d["task"]["power"]:
                specials.append({
                    "disc": d["name"],
                    "spot": d["spot"],
                    "power": d["task"]["power"],
                    "does": POWER_TEXT[d["task"]["power"]],
                    "task": d["task"]["text"],
                })
        return {
            "host": self.host,
            "specials": specials,
            "single_mole": self.single_mole,
            "players": [{"name": p["name"], "team": p["team"]} for p in self.players],
            "moles": [p["name"] for p in self.players if p["mole_for"]],
            "per_game": SPECIALS_PER_GAME,
            "pool": [{"power": t[0], "does": POWER_TEXT[t[0]],
                      "when": "play" if t[0] in PLAY_POWERS else "end"} for t in ALL_SPECIALS],
        }

    def set_specials(self, powers):
        """The host swaps which powers are live. The special DISCS and their hiding
        spots stay put - only which power each of those discs carries changes."""
        if not self.host or self.phase != "hiding":
            return "Only the host can choose the powers, before roles are read."
        by_name = dict((t[0], t) for t in ALL_SPECIALS)
        powers = list(powers or [])
        if len(powers) != SPECIALS_PER_GAME or len(set(powers)) != SPECIALS_PER_GAME \
                or any(p not in by_name for p in powers):
            return "Pick exactly %d different powers." % SPECIALS_PER_GAME
        slots = [fp for fp in self.order if self.deck[fp]["task"]["power"]]
        for fp, power in zip(slots, powers):
            _, text, seconds = by_name[power]
            self.deck[fp]["task"] = {"text": text, "seconds": seconds, "judged": "pass",
                                     "author": None, "power": power}
        return None

    def set_moles(self, names):
        """The host may hand-pick the moles instead of keeping the random pick.
        Only before roles are read - after that, people already know who they are."""
        if not self.host or self.phase != "hiding":
            return "Moles can only be changed by the host, before roles are read."
        chosen = [p for p in self.players if p["name"] in (names or [])]
        if self.single_mole:
            if len(chosen) != 1:
                return "Pick exactly one mole."
        else:
            teams = sorted(p["team"] for p in chosen)
            if teams != ["A", "B"]:
                return "Pick one mole from each team."
        for p in self.players:
            p["mole_for"] = None
        for p in chosen:
            p["mole_for"] = "B" if p["team"] == "A" else "A"
        return None

    def to_briefing(self):
        self.phase = "briefing"

    def begin_play(self):
        self.phase = "play"
        self.started_at = time.time()

    # -- disc events ----------------------------------------------

    def on_insert(self, fingerprint, label):
        with self.lock:
            self.tray = {"fingerprint": fingerprint, "label": label}
            if self.phase == "setup":
                if self.register(fingerprint, label):
                    self.message = "Registered: " + label
                else:
                    self.message = "Already registered: " + label
                return
            # A team with its own task running can still bring a disc to the tray -
            # it just can't claim it. The other team can.
            if self.phase != "play" or self.pending:
                return
            disc = self.deck.get(fingerprint)
            if not disc:
                self.message = "That disc is not part of tonight's game."
                return
            if disc["claimed_by"]:
                self.message = "%s was already claimed by Team %s." % (
                    disc["name"], disc["claimed_by"])
                return
            self.pending = fingerprint

    def on_eject(self):
        with self.lock:
            self.tray = None
            # Taking an unclaimed disc back out puts it back in play. Without this,
            # a disc nobody could claim (both teams busy) jammed the tray for good.
            if self.pending:
                self.pending = None
                if self.phase == "play":
                    self.message = "Disc taken out unclaimed. It is back in play."

    def on_unreadable(self, root, err):
        """A disc is physically in the tray but carries no file system."""
        with self.lock:
            self.tray = {"fingerprint": None, "label": "UNREADABLE"}
            self.message = (
                "There is a disc in %s but it has no files on it - it is blank, "
                "or an audio CD. Opti-Mole identifies a disc by what is written on "
                "it, so it needs a disc with content. Try a movie."
                % root.rstrip("\\"))
            print("[opti-mole] unreadable disc in %s (windows error %s)" % (root, err),
                  flush=True)

    def simulate(self, fingerprint):
        for d in self.collection:
            if d["fingerprint"] == fingerprint:
                self.on_insert(d["fingerprint"], d["label"])
                return

    # -- play -----------------------------------------------------

    def claim_by_code(self, code):
        """Claiming the tray costs you your team passcode. Two honour-system
        buttons meant anyone could take anyone's disc by leaning over."""
        code = (code or "").strip()
        for team, real in self.codes.items():
            if code == real:
                self.claim(team)
                return team
        self.message = "Wrong code."
        return None

    def release(self):
        """Laptop button: the disc in the tray goes back in play unclaimed."""
        with self.lock:
            if self.pending:
                self.pending = None
                self.message = "Disc put back in play."

    def claim(self, team):
        with self.lock:
            if not self.pending:
                return
            if self.active.get(team):
                # one task per team - otherwise a team could stack discs and clog the tray
                self.message = "Team %s already has a task running. Log it or give up first." % team
                return
            fp = self.pending
            self.pending = None
            disc = self.deck[fp]
            disc["claimed_by"] = team
            now = time.time()
            loads_until = now
            if self.slowed.get(team):
                # SCRATCHED: the task stays hidden while the disc "loads", and the
                # loading time is added in front of the task, so it comes off their clock
                self.slowed[team] = False
                loads_until = now + SCRATCH_SECONDS
            self.active[team] = {
                "fingerprint": fp,
                "team": team,
                "task": disc["task"],
                "disc_name": disc["name"],
                "loads_until": loads_until,
                "ends_at": loads_until + disc["task"]["seconds"],
                "contest": None,        # set when a HIJACK turns this into a race
                "hijack_of": None,      # set on the hijacking team's copy
                "race": False,          # set on both copies of a real race
                "race_from": None,      # the team whose disc started it
            }
            self.message = ("Team %s's disc is scratched - loading for %d seconds."
                            % (team, SCRATCH_SECONDS)) if loads_until > now else ""

            # A race task used to go to whichever team happened to find the disc,
            # which meant nobody ever raced anybody and the bonus was free. Deal
            # it to both teams at once instead, on their own clocks.
            other = "B" if team == "A" else "A"
            if disc["task"]["judged"] == "race" and not self.active.get(other):
                contest = "r%d" % int(time.time() * 1000)
                self.active[team]["contest"] = contest
                self.active[team]["race"] = True
                self.active[team]["race_from"] = team
                self.active[other] = dict(
                    self.active[team],
                    team=other,
                    loads_until=now,                 # their clock is their own
                    ends_at=now + disc["task"]["seconds"],
                )
                self.message = ("Team %s claimed a RACE - Team %s is in it too. "
                                "First photograph the room accepts takes the bonus."
                                % (team, other))
            elif disc["task"]["judged"] == "race":
                self.message = ("Team %s claimed a race task, but Team %s is already busy - "
                                "no race, no bonus." % (team, other))

    def task_view(self, team):
        a = self.active.get(team)
        if not a:
            return None
        loading = max(0, int(round(a.get("loads_until", 0) - time.time())))
        return {
            "team": team,
            "disc_name": a["disc_name"],
            # while a scratched disc loads, nobody - not even its team - sees the task
            "text": "Loading..." if loading else a["task"]["text"],
            "seconds": a["task"]["seconds"],
            "judged": a["task"]["judged"],
            "power": None if loading else a["task"]["power"],
            "author": None if loading else a["task"]["author"],
            "left": max(0, int(a["ends_at"] - time.time())),
            "loading": loading,
            "hijack_of": a["hijack_of"],
            "contested": bool(a["contest"]),
        }

    def is_loading(self, team):
        a = self.active.get(team)
        return bool(a and a.get("loads_until", 0) > time.time())

    def can_hijack(self, team):
        other = "B" if team == "A" else "A"
        theirs = self.active.get(other)
        return bool(self.phase == "play" and self.hijacks.get(team, 0) > 0
                    and not self.active.get(team)
                    and theirs and not theirs["hijack_of"] and not theirs["contest"]
                    and not self.is_loading(other))

    def can_scratch(self, team):
        other = "B" if team == "A" else "A"
        return bool(self.phase == "play" and self.scratches.get(team, 0) > 0
                    and not self.slowed.get(other))

    def scratch(self, team):
        """The other team's NEXT claimed disc loads slowly. Doesn't touch the tray."""
        with self.lock:
            if not self.can_scratch(team):
                self.message = "Team %s can't scratch right now." % team
                return False
            other = "B" if team == "A" else "A"
            self.slowed[other] = True
            self.scratches[team] -= 1
            self.message = "Team %s SCRATCHED Team %s's next disc." % (team, other)
            return True

    def hijack(self, team):
        """Join the other team's running task, on their clock. Both may log it;
        at the reel the first photo the room accepts takes the points."""
        with self.lock:
            if not self.can_hijack(team):
                self.message = "Team %s can't hijack right now." % team
                return False
            other = "B" if team == "A" else "A"
            theirs = self.active[other]
            contest = "c%d" % int(time.time() * 1000)
            theirs["contest"] = contest
            self.active[team] = dict(theirs, team=team, hijack_of=other, contest=contest)
            self.hijacks[team] -= 1
            self.message = "Team %s HIJACKED Team %s's task." % (team, other)
            return True

    def _first_on(self, text):
        for row in self.log:
            if row["text"] == text:
                return False
        return True

    def finish_task(self, team, photo=None, note=""):
        with self.lock:
            act = self.active.get(team)
            if not act:
                return          # a team can only ever log its own running task
            if self.is_loading(team):
                return          # you can't finish a task you haven't been shown yet
            power = act["task"]["power"]
            if power in PLAY_POWERS and not act["hijack_of"]:
                # earned now, not at the reel: these are used during play
                if power == "HIJACK":
                    self.hijacks[team] += 1
                else:
                    self.scratches[team] += 1
                self.message = "Team %s now holds a %s." % (team, power)
            self.log.append({
                "contest": act["contest"],
                "hijack_of": act["hijack_of"],
                "race": bool(act.get("race")),
                "id": len(self.log),
                "team": act["team"],
                "disc": act["disc_name"],
                "text": act["task"]["text"],
                "seconds": act["task"]["seconds"],   # what it is worth is set by this
                "judged": act["task"]["judged"],
                "power": act["task"]["power"],
                "author": act["task"]["author"],
                "photo": photo,
                "note": note,
                "late": time.time() > act["ends_at"],
                "verdict": None,
                "score": 0,
                "first": self._first_on(act["task"]["text"]),
            })
            self.active[team] = None

    def abandon(self, team):
        with self.lock:
            act = self.active.get(team)
            if not act:
                return
            self.active[team] = None
            other = "B" if team == "A" else "A"
            still_racing = self.active.get(other) and self.active[other]["contest"] \
                and self.active[other]["contest"] == act["contest"]
            borrowed = bool(act["hijack_of"]) or (act.get("race")
                                                  and act.get("race_from") != team)
            # if anyone in this contest already logged it, the disc has been played
            logged = bool(act["contest"]) and any(r.get("contest") == act["contest"]
                                                  for r in self.log)
            if borrowed or still_racing or logged:
                # somebody else is still on this task, or already did it
                self.message = "Team %s gave up. That disc stays used." % team
            else:
                self.deck[act["fingerprint"]]["claimed_by"] = None
                self.message = "Task abandoned. That disc is back in play."

    def leads(self):
        out = {}
        unclaimed = [self.deck[fp] for fp in self.order if not self.deck[fp]["claimed_by"]]
        if self.host:
            # the host hid the special discs and hints at them out loud - the app
            # never points a team straight at one
            unclaimed = [d for d in unclaimed if not d["task"]["power"]]
        for team in ("A", "B"):
            if not unclaimed:
                out[team] = None
            else:
                out[team] = unclaimed[0 if team == "A" else -1]["spot"]
        return out

    def remaining(self):
        if self.started_at is None:
            return self.length
        return max(0, int(self.length - (time.time() - self.started_at)))

    # -- endgame --------------------------------------------------

    def to_reel(self):
        with self.lock:
            self.phase = "reel"
            self.reel_index = 0
            self.message = ""
            self.active = {"A": None, "B": None}
            self.pending = None
            if not self.log:
                self.phase = "powers"

    def voters_expected(self):
        """Everyone entitled to judge. The host is not a player and does not vote -
        they hid the discs and know too much."""
        return [p["name"] for p in self.players]

    def claim_seat(self, token, name):
        with self.lock:
            return self._claim_seat(token, name)

    def _claim_seat(self, token, name):
        """A phone says who is holding it, so its votes have a name on them.
        A name can only be held by one phone at a time - otherwise a second
        handset could vote twice, or vote as somebody else."""
        team = self.team_of(token)
        if not team:
            return "expired"
        name = " ".join((name or "").split())
        who = None
        for p in self.players:
            if p["name"] == name:
                who = p
        if not who:
            return "No player called that."
        if who["team"] != team:
            return "%s is not on team %s." % (name, team)
        for tok, held in self.voters.items():
            if held == name and tok != token:
                return "Someone is already voting as %s." % name
        self.voters[token] = name
        return None

    def vote(self, token, row_id, yes):
        """One player, one photograph. You may change your mind until it closes."""
        with self.lock:
            if self.phase != "reel":
                return "The reel is not running."
            name = self.voters.get(token or "")
            if not name:
                return "Say who you are first."
            if self.reel_index >= len(self.log):
                return "Nothing to judge."
            row = self.log[self.reel_index]
            if row_id is not None and int(row_id) != row["id"]:
                return "That photograph has gone by."
            self.votes.setdefault(row["id"], {})[name] = bool(yes)
            if len(self.votes[row["id"]]) >= len(self.voters_expected()):
                self.close_vote()
            return None

    def vote_count(self, row_id):
        """Numbers only. No name goes on the shared screen until the record."""
        v = self.votes.get(row_id) or {}
        yes = sum(1 for b in v.values() if b)
        return {"yes": yes, "no": len(v) - yes, "in": len(v),
                "of": len(self.voters_expected())}

    def close_vote(self):
        with self.lock:
            if self.phase != "reel" or self.reel_index >= len(self.log):
                return
            row = self.log[self.reel_index]
            c = self.vote_count(row["id"])
            if not c["in"]:
                self.message = "Nobody has voted. Call it at the laptop."
                return
            if c["yes"] == c["no"]:
                self.message = ("Tied %d-%d. The room has to settle this one out loud."
                                % (c["yes"], c["no"]))
                return
            self._settle("accept" if c["yes"] > c["no"] else "reject")

    def judge(self, verdict):
        """The laptop calling it: no phones in the room, or a tie to break."""
        with self.lock:
            self._settle(verdict)

    def _race_leader(self, row):
        """The first accepted photograph in a race takes the bonus."""
        return not any(r.get("contest") == row["contest"] and r["verdict"] == "accept"
                       for r in self.log[:self.reel_index])

    def _settle(self, verdict):
        if self.reel_index >= len(self.log):
            return
        row = self.log[self.reel_index]
        row["verdict"] = verdict
        beaten = False
        if verdict == "accept" and row.get("contest") and not row.get("race"):
            # a hijacked task is one task two teams did, so only the first
            # accepted photo scores. A race is two teams doing it separately -
            # both count, and only the bonus is at stake.
            beaten = any(r.get("contest") == row["contest"] and r["verdict"] == "accept"
                         for r in self.log[:self.reel_index])
        if verdict == "accept" and beaten:
            row["score"] = 0
            row["verdict"] = "beaten"
        elif verdict == "accept":
            row["score"] = score_for(row.get("seconds"))
            # a race task claimed while the other team was busy is just a task:
            # there was no race to win, so there is no bonus to take
            if row.get("race") and row.get("contest") and self._race_leader(row):
                row["score"] += SCORE_RACE_BONUS
            if row["late"]:
                row["score"] = max(0, row["score"] - SCORE_LATE)
            if row["power"] and row["power"] not in PLAY_POWERS:   # those were held when logged
                self.powers[row["team"]].append(row["power"])
        else:
            row["score"] = 0
        self.reel_index += 1
        if self.reel_index >= len(self.log):
            # the record only means anything if the room actually voted
            self.phase = "record" if any(self.votes.values()) else "powers"

    def record(self):
        """Who stood where on the photographs the room disagreed about.

        Unanimous votes say nothing about anybody, so they are left out. What is
        left is the only trail a Mole leaves - and honest people disagree about
        the ambiguous ones too, which is what keeps it an argument, not proof."""
        team_of = dict((p["name"], p["team"]) for p in self.players)
        counts = dict((n, {"name": n, "team": t, "against_own": 0,
                           "for_theirs": 0, "voted": 0})
                      for n, t in team_of.items())
        rows = []
        judged = 0
        for row in self.log:
            v = self.votes.get(row["id"]) or {}
            if not v:
                continue
            judged += 1
            for name in v:
                if name in counts:
                    counts[name]["voted"] += 1
            yes = sorted([n for n, b in v.items() if b])
            no = sorted([n for n, b in v.items() if not b])
            if not yes or not no:
                continue
            rows.append({"id": row["id"], "team": row["team"], "disc": row["disc"],
                         "text": row["text"], "verdict": row["verdict"],
                         "photo": row["photo"], "yes": yes, "no": no})
            for name, b in v.items():
                if name not in counts:
                    continue
                if team_of[name] == row["team"] and not b:
                    counts[name]["against_own"] += 1
                elif team_of[name] != row["team"] and b:
                    counts[name]["for_theirs"] += 1
        people = sorted(counts.values(),
                        key=lambda c: (-c["against_own"], -c["for_theirs"], c["name"]))
        return {"rows": rows, "people": people, "judged": judged, "split": len(rows)}

    def to_powers(self):
        with self.lock:
            self.phase = "powers"

    def use_power(self, team, power, target):
        with self.lock:
            if power not in self.powers.get(team, []):
                return
            other = "B" if team == "A" else "A"
            self.powers[team].remove(power)
            record = {"team": team, "power": power, "detail": ""}

            if power == "CONFESSION":
                moles = [p["name"] for p in self.players
                         if p["team"] == team and p["mole_for"]]
                record["detail"] = ("The Mole in Team %s is %s." % (team, ", ".join(moles))
                                    if moles else "There is no Mole in Team %s." % team)
                self.accusations[team] = {"named": moles, "confessed": True}

            elif power == "VETO":
                for row in self.log:
                    if row["id"] == target:
                        row["score"] = 0
                        row["verdict"] = "vetoed"
                        record["detail"] = "Struck: " + row["text"]

            elif power == "TESTIMONY":
                for row in self.log:
                    if row["id"] == target:
                        row["score"] = score_for(row.get("seconds"))
                        row["verdict"] = "accept"
                        record["detail"] = "Restored: " + row["text"]

            elif power == "SHIELD":
                record["detail"] = "Team %s's Mole guess will not score either way." % team

            elif power == "LONG COUNT":
                best = None
                for row in self.log:
                    if row["team"] == team and (best is None or row["score"] > best["score"]):
                        best = row
                if best:
                    best["score"] *= 2
                    record["detail"] = "Doubled: " + best["text"]

            self.spent.append(record)

    def to_accusation(self):
        with self.lock:
            self.phase = "accusation"

    def accuse(self, team, name):
        with self.lock:
            if self.accusations.get(team, {}).get("confessed"):
                return
            self.accusations[team] = {"named": [name], "confessed": False}

    def to_results(self):
        with self.lock:
            self.phase = "results"

    def scores(self):
        total = {"A": 0, "B": 0}
        for row in self.log:
            total[row["team"]] += row["score"]

        lines = []
        shielded = set(r["team"] for r in self.spent if r["power"] == "SHIELD")

        for team in ("A", "B"):
            other = "B" if team == "A" else "A"
            real = [p["name"] for p in self.players if p["team"] == team and p["mole_for"]]
            if not real:
                continue
            acc = self.accusations.get(team)
            if team in shielded and acc and not acc.get("confessed"):
                lines.append("Team %s shielded the accusation against them. No swing." % team)
                continue
            named = acc["named"] if acc else []
            hit = [n for n in named if n in real]
            if hit:
                total[team] += SCORE_ACCUSE
                lines.append("Team %s named their Mole (%s): +%d"
                             % (team, ", ".join(hit), SCORE_ACCUSE))
            else:
                total[other] += SCORE_MOLE_SURVIVES
                lines.append("Team %s's Mole (%s) was never named: +%d to Team %s"
                             % (team, ", ".join(real), SCORE_MOLE_SURVIVES, other))
        return total, lines

    # -- snapshot -------------------------------------------------

    def snapshot(self):
        with self.lock:
            pending = None
            if self.pending:
                d = self.deck[self.pending]
                pending = {"name": d["name"]}

            active = {"A": self.task_view("A"), "B": self.task_view("B")}

            if self.phase == "results":
                totals, notes = self.scores()
            else:
                totals, notes = {"A": 0, "B": 0}, []
                for row in self.log:
                    totals[row["team"]] += row["score"]

            return {
                "phase": self.phase,
                "message": self.message,
                "sim": self.sim,
                "collection": self.collection,
                "custom": self.custom,
                "players": [{"name": p["name"], "team": p["team"]} for p in self.players],
                "clock": self.remaining(),
                "length": self.length,
                "tray": self.tray,
                "pending": pending,
                "active": active,
                "leads": self.leads() if self.phase == "play" else {},
                "discs_left": sum(1 for fp in self.order if not self.deck[fp]["claimed_by"]),
                "discs_total": len(self.order),
                "hiding": ([{"name": d["hider"], "disc": d["name"], "spot": d["spot"]}
                            for d in self.deck.values()
                            if not (self.host and d["hider"] == self.host)]
                           if self.phase == "hiding" else []),
                "host": self.host,
                "hijacks": self.hijacks,
                "can_hijack": {"A": self.can_hijack("A"), "B": self.can_hijack("B")},
                "scratches": self.scratches,
                "can_scratch": {"A": self.can_scratch("A"), "B": self.can_scratch("B")},
                "slowed": self.slowed,
                "log": self.log,
                "reel_index": self.reel_index,
                # counts only - names would hand the room the Mole on photo one
                "vote": (self.vote_count(self.log[self.reel_index]["id"])
                         if self.phase == "reel" and self.reel_index < len(self.log)
                         else None),
                "seated": len(self.voters),
                "record": self.record() if self.phase in ("record", "results") else None,
                "powers": self.powers,
                "power_text": POWER_TEXT,
                "spent": self.spent,
                "accusations": self.accusations,
                "totals": totals,
                "notes": notes,
                "join": "http://%s:%d/phone" % (lan_ip(), PORT),
                "phones": {"A": self.phone_count("A"), "B": self.phone_count("B")},
            }

    def role_for(self, name):
        """Private, one player at a time. Their team passcode rides along here so
        it is never printed on the shared screen where the other team can read it."""
        for p in self.players:
            if p["name"] == name:
                return {
                    "mole": bool(p["mole_for"]),
                    "team": p["team"],
                    "loyal_to": p["mole_for"] or p["team"],
                    "code": self.codes.get(p["team"]),
                    "join": "http://%s:%d/phone" % (lan_ip(), PORT),
                }
        return None


GAME = Game()

# ---------------------------------------------------------------- http

class Handler(http.server.BaseHTTPRequestHandler):

    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, payload, code=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, local, ctype):
        with open(local, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = self.path.split("?")
        path = parts[0]
        query = parts[1] if len(parts) > 1 else ""

        if path == "/api/state":
            return self._send(GAME.snapshot())
        if path == "/api/phone/state":
            token = ""
            for bit in query.split("&"):
                if bit.startswith("token="):
                    token = urllib.parse.unquote(bit[6:])
            return self._send(GAME.phone_state(token))
        if path == "/":
            path = "/index.html"
        if path == "/phone":
            path = "/phone.html"

        if path.startswith("/photos/"):
            local = os.path.join(PHOTO_DIR, os.path.basename(path))
        elif path.startswith("/narration/"):
            local = os.path.join(WEB_DIR, "narration", os.path.basename(path))
        else:
            local = os.path.join(WEB_DIR, os.path.basename(path))

        if not os.path.isfile(local):
            self.send_error(404)
            return

        ctype = "text/plain; charset=utf-8"
        if local.endswith(".html"):
            ctype = "text/html; charset=utf-8"
        elif local.endswith(".css"):
            ctype = "text/css; charset=utf-8"
        elif local.endswith(".js"):
            ctype = "application/javascript; charset=utf-8"
        elif local.endswith(".jpg"):
            ctype = "image/jpeg"
        elif local.endswith(".ttf"):
            ctype = "font/ttf"
        elif local.endswith(".mp3"):
            ctype = "audio/mpeg"
        self._file(local, ctype)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            data = {}
        action = data.get("action", "")
        g = GAME

        # ---- phone endpoints: authenticated by team token, never by a button
        if action == "phone_join":
            token, team = g.join(data.get("code"))
            if not token:
                return self._send({"ok": False, "error": "No team has that code."})
            return self._send({"ok": True, "token": token, "team": team})

        if action == "phone_iam":
            err = g.claim_seat(data.get("token"), data.get("name"))
            if err:
                return self._send({"ok": False, "error": err})
            return self._send(g.phone_state(data.get("token")))

        if action == "phone_vote":
            err = g.vote(data.get("token"), data.get("row"), bool(data.get("yes")))
            if err:
                return self._send({"ok": False, "error": err})
            return self._send(g.phone_state(data.get("token")))

        if action == "phone_scratch":
            team = g.team_of(data.get("token"))
            if not team:
                return self._send({"ok": False, "error": "expired"})
            g.scratch(team)
            return self._send(g.phone_state(data.get("token")))

        if action in ("phone_claim", "phone_finish", "phone_abandon", "phone_hijack"):
            team = g.team_of(data.get("token"))
            if not team:
                return self._send({"ok": False, "error": "expired"})
            if action == "phone_claim":
                g.claim(team)
            elif action == "phone_finish":
                g.finish_task(team, save_photo(data.get("photo")), data.get("note", ""))
            elif action == "phone_abandon":
                g.abandon(team)
            else:
                g.hijack(team)
            return self._send(g.phone_state(data.get("token")))

        if action == "rename":
            g.rename_disc(data["fingerprint"], data["name"])
        elif action == "forget":
            g.forget_collection()
        elif action == "sim_register":
            fp = hashlib.sha1(("sim" + str(data["n"])).encode()).hexdigest()[:16]
            g.register(fp, data.get("label") or ("SIM DISC %s" % data["n"]))
        elif action == "sim_insert":
            g.simulate(data["fingerprint"])
        elif action == "add_task":
            g.add_custom(data["text"], data["seconds"], data["judged"], data.get("author", ""))
        elif action == "delete_task":
            g.delete_custom(int(data["index"]))
        elif action == "start":
            g.start(data["players"], data["minutes"], bool(data.get("single_mole")),
                    data.get("host"))
        elif action == "role":
            return self._send({"role": g.role_for(data["name"])})
        elif action == "host_brief":
            return self._send({"brief": g.host_brief()})
        elif action == "set_moles":
            err = g.set_moles(data.get("names"))
            return self._send({"ok": err is None, "error": err, "brief": g.host_brief()})
        elif action == "to_briefing":
            g.to_briefing()
        elif action == "begin_play":
            g.begin_play()
        elif action == "claim_code":
            g.claim_by_code(data.get("code"))
        elif action == "release":
            g.release()
        elif action in ("hijack_code", "scratch_code"):
            # laptop fallback for teams with no phone: the team code authorises it
            for team, real in g.codes.items():
                if (data.get("code") or "").strip() == real:
                    if action == "hijack_code":
                        g.hijack(team)
                    else:
                        g.scratch(team)
                    break
            else:
                g.message = "Wrong code."
        elif action == "set_specials":
            err = g.set_specials(data.get("powers"))
            return self._send({"ok": err is None, "error": err, "brief": g.host_brief()})
        elif action == "finish":
            if data.get("team") in ("A", "B"):
                g.finish_task(data["team"], save_photo(data.get("photo")), data.get("note", ""))
        elif action == "abandon":
            if data.get("team") in ("A", "B"):
                g.abandon(data["team"])
        elif action == "to_reel":
            g.to_reel()
        elif action == "judge":
            g.judge(data["verdict"])
        elif action == "close_vote":
            g.close_vote()
        elif action == "to_powers":
            g.to_powers()
        elif action == "use_power":
            g.use_power(data["team"], data["power"], data.get("target"))
        elif action == "to_accusation":
            g.to_accusation()
        elif action == "accuse":
            g.accuse(data["team"], data["name"])
        elif action == "to_results":
            g.to_results()
        elif action == "reset":
            g.reset_soft()

        return self._send(g.snapshot())


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    os.makedirs(PHOTO_DIR, exist_ok=True)
    DiscWatcher(GAME).start()
    ip = lan_ip()
    print("\n   O P T I - M O L E\n", flush=True)
    print("   laptop   http://localhost:%d" % PORT, flush=True)
    print("   phones   http://%s:%d/phone" % (ip, PORT), flush=True)
    print("\n   (phones must be on the same wifi as this computer)\n", flush=True)
    # 0.0.0.0 so phones on the house network can reach it, not just this machine
    Server(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
