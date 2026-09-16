# OPTI-MOLE

A party game for two teams that runs on a computer, a DVD drive, and twenty
DVDs you already own. The game never plays the discs. It only reads them.

```bash
python server.py
```

It prints two addresses:

```
laptop   http://localhost:7321
phones   http://192.168.x.x:7321/phone
```

Put the laptop next to the drive. Everyone else opens the phone address on the
house wifi. Python 3 only — no pip install, no internet, no account.

**New players: press *tutorial* on the home screen** - a narrated, animated walkthrough that plays start to finish on its own (about two minutes).

**The full rule list is [web/RULES.md](web/RULES.md)** - the same file the game shows under *rules* on the home screen.

---

## What you need

- Any computer with an optical drive (a $20 USB one is fine)
- 20 DVDs. Any DVDs. Shrek 2, a burned wedding video, the Planet Earth box set
- 4+ people, split into two teams (a phone each for the reel)
- A house

No drive? The app drops into **simulator mode** automatically and gives you
twenty fake discs so you can play the whole thing through.

## How a night goes

**Setup.** Feed each disc through the tray once. It gets fingerprinted from its
volume label plus a hash of its file table, and remembered forever. You only do
this once per collection.

**Host (optional).** A non-player who hides the special discs, gives up to 3 minor and 2 big clues out loud, and may hand-pick the Moles. The host takes the laptop first.

**Hiding.** The laptop goes round the room. It names one player and waits —
nothing is on screen until that person says they have it. Then it privately
tells them where to hide two or three discs: *above head height*, *somewhere
cold*, *in a room with a mirror*. The app never learns your house; those
descriptions are also the search hints later. Everyone knows a little. Nobody
knows the map.

**Roles.** One at a time, alone with the screen. One player on each team is
secretly loyal to the other side. This screen also hands you **your team's
four-digit passcode** and the phone address — privately, because printing the
codes on the shared screen would give them to the other team.

**Phones.** Open the phone address, type your team code, done. The phone is
your team's half of the game: it shows your lead, claims the tray, carries the
running task and its countdown, and takes the photographs. Any number of phones
per team; they all see the same thing. One between you is enough for the hunt,
but bring them all to the table for the reel - that is where each player picks
their own name and votes.

**Play.** Find a disc, bring it to the tray, insert it. Claiming it costs your
team passcode — typed on the laptop or tapped on a phone — so nobody takes a
disc by leaning over and pressing a button. Then do the task, photograph it,
log it. The clock runs top-centre of the laptop and on every phone.

Three discs are **special** each game, carrying 3 of the 7 powers - the
computer picks them, or the host does. End-of-game powers are banked at the
reel; the play powers, **HIJACK** and **SCRATCH**, are used during play to join
the other team's task or slow their next disc. Both teams can run a task at the
same time.

**The reel.** Every photograph both teams logged, in order, on the shared
screen. The room argues each one out loud, and then **everybody votes on their
own phone** - counts, or does not. The screen shows how many are in and nothing
else. A task is worth 10, 15 or 20 by how long it was given.

**The record.** Before any power is spent, the votes come out: every photograph
the room disagreed about, who stood where, and how many times each player voted
against their own team. Unanimous votes are left out because they say nothing.
This is the only trail the Mole leaves, and it is evidence, not proof - honest
people disagree about the ambiguous ones too.

**Powers.** Everything banked, spent at once — including CONFESSION, which
names the Mole in your ranks out loud. Your Mole is sitting at this table and
has opinions about which power you should spend.

**Accusations.** Each team names their Mole. Then everything is revealed.

## Writing your own tasks

Setup → *write your own tasks*. Four fields: the instruction, a time limit, how
it is judged (vote / pass-fail / race), and who wrote it. Your tasks get dealt
onto discs alongside the built-in ones, and the screen credits you by name when
one fires.

They live in `data/custom_tasks.json`. Copy that file to share a pack.

## Files

```
server.py               game engine, disc watcher, tiny HTTP server
web/index.html          the laptop: timer bar and stage
web/app.js              every laptop screen
web/style.css           DVD menu, circa 2003
web/phone.html          the phone
web/phone.js            join, claim, camera
web/phone.css           the same menu, sized for a thumb
web/sound.js            menu music and button pops, synthesised - no audio files
web/tutorial.js         the animated tutorial: 12 drawn scenes, narrated
web/tutorial.css        its look
web/narration/          the tutorial's recorded voice, 01.mp3 - 12.mp3 (one per scene; a missing clip falls back to the built-in voice)
web/RULES.md            the rules - shown in-game, edit here to change them
web/baloo.ttf           the title font (Baloo, SIL Open Font License - see FONT-LICENSE.txt)
data/collection.json    your registered discs (survives everything)
data/custom_tasks.json  tasks your house wrote
data/photos/            the reel
```

## Notes

Sound is generated live with Web Audio: a slow four-chord pad with a long
reverb on the home menu (it fades out when the game starts), and a soft falling
pop on every button. Browsers will not play anything until the page is clicked
once, so the music starts on your first click. Toggles sit bottom-right and
remember your choice.

Phone photos go through the native camera app (`capture="environment"`), not
`getUserMedia`. Browsers refuse camera access over plain http, and nobody is
installing a certificate at a party. They are resized to 1400px on the phone
before upload, because this server is the Python standard library.

The server binds `0.0.0.0` so phones on your wifi can reach it. That is the
whole point, but it does mean anything on your network can open the page —
joining still needs a team code.

Team codes are regenerated every game and never appear in the shared snapshot.
If someone loses theirs, they are printed in the server console.

The optical drive is polled with a cheap volume-info call; the expensive file
table walk only happens on the transition from empty tray to disc, so the drive
is not spinning all night.

If two discs fingerprint identically — some burned discs ship with a generic
volume label and no files — setup will show them as one entry. Swap one out.

The disc is what has to come back to the machine, not the photograph. A task is
claimed at the tray and photographed wherever it happens.
