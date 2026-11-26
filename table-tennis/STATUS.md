# FlickPong status

Live at **https://flickpong.vercel.app**, and on your site at https://www.shivanshsukhija.com/table-tennis/ (the old table-tennis-six-xi.vercel.app link still works). Last updated 25 Nov 2026.

## Checking it yourself

- **Play:** open the link on your laptop, scan the QR code with your phone, tap Start, and hold the phone like a remote.
- **Play a friend:** click **Play a friend online** under the QR code (or pick "A friend" on your phone later), then send the invite link the game shows. Your friend opens it on their own laptop and scans its code with their own phone.
- **Tests:** run `npm test` in this folder. It runs 56 checks in about 10 seconds and needs nothing installed.
- **Database rules:** run `npm install` once, then `npm run test:rules`. It runs 16 checks against Firebase's own rules engine in a local emulator, needs Java, and never touches the real database.
- **Online test:** `npm run e2e:online` plays friends through the relay and checks its rules, against a local copy of the database. It needs Java, like the rules test.
- **Browser test:** run `npm install` once, plus `npx playwright install chromium`, then `npm run e2e`. It drives a real game tab and a real phone tab through the whole game, then plays an online match between two laptops with two phones (65 checks).
- **Local run with lag numbers:** `npm run dev`, then open http://localhost:8790. **D** shows the lag panel and **P** switches lag compensation (off, half, full).

## What's been checked

### Lag and smoothness
- **Measured live on your iPhone and Mac.** "Reading → frame" is the time from your phone's sensor reading to the laptop drawing it. It went from **54 ms to 23 ms** after the buffer was retuned for your Wi-Fi. Your screen adds roughly 20–30 ms on top, which the browser can't measure.
- **Where the time went:** your phone handles each reading within 0.3 ms, the laptop holds a steady 60 fps, and readings usually cross Wi-Fi in 13 ms. The old smoothing buffer was the biggest delay, at 47 ms. It's now about 20 ms.
- **Stutter on screen, in simulation** (the worst 1% of frames, in how far the paddle strays from your real movement):

  | Wi-Fi | Lag | Stutter |
  |---|---|---|
  | Clean | 2 ms | 1.0 cm |
  | Normal | 8 ms | 1.1 cm |
  | Poor, bunched readings | 33 ms | 2.0 cm |
  | Your home Wi-Fi, modelled from the live session | 24 ms | 3.3 cm |

  When Wi-Fi freezes, the paddle glides back into place. Its biggest single jump is now 8 cm (it was 44 cm).

### Hitting and serving
- **Flicks count even when late.** A flick takes about 60 ms to reach the game, so if it lands up to 0.1 s after the ball met the paddle, the shot is replayed from the moment of contact with full power.
- **Serves go in 98–100% of the time,** whether you flick early, on time, or as the ball reaches the paddle (83% when flicking late on poor Wi-Fi).
- **Swings don't move the paddle.** A flick doesn't shift where the paddle points, so swinging never pushes it off the ball.

### Physics, checked against real table tennis (`test/physics.test.js`)
- **Air drag:** the ball falls no faster than 8.5–9.5 m/s, like a real ball.
- **Table bounce:** dropped from 30.5 cm, the ball comes back to about 23 cm, as the rules require. It was 21.7 cm, so the table was slightly dead. **Fixed.**
- **Topspin** dips sooner and kicks forward off the table.
- **Backspin** floats and lands longer.
- **Sidespin** curves the ball.
- **No bounce adds energy.**
- **Planned shots land within 3 cm of where they're aimed.**

### What you see, measured over full simulated matches (`test/look.test.js`)

| | Before | Now |
|---|---|---|
| Your hits struck from outside the drawn paddle | 17% | 3.6%, and the paddle visibly reaches for those |
| Opponent's hits from outside its paddle | 35% | 0% |
| Opponent paddle jumping | up to 34 cm in one frame | never more than 8 cm (a believable lunge) |
| Opponent shot types | 97% the same flat drive at about 850 rpm | drives and loops about half and half, 1,000–2,200 rpm |
| Opponent net clearance | skimmed at 7 cm | 4 to 30 cm depending on the shot |
| Your shots | almost all to the end line, often coming back as chops | blocks drop mid-table and hard flicks go deep; returns are drives or topspin |
| Late-flick replay | ball visibly slid up to 46 cm | eases in over up to 0.16 s |

### Balance
Share of points won, from 8 simulated games per cell:

| | Weak player | Average player | Good player |
|---|---|---|---|
| Beginner | 79% | 99% | 100% |
| Club | 22% | 55% | 88% |
| Pro | 6% | 32% | 69% |

Rallies average 4–24 strokes, getting longer with skill. The opponent gets slightly likelier to slip the longer a rally goes.

### The look
- **A daylit studio** instead of the dark room, lit like a product shot. A pale maple floor fades into cool white air, so the warmth comes from the wood alone. Daylight falls softly from the front left, and the wood, rubber and metal pick up soft studio reflections. The air was first a warm cream; it was changed to neutral white because cream read as a generic default rather than the Apple-like look asked for.
- **Real wood, drawn in code.** The table is tournament blue on a walnut apron with oak legs. Each paddle has a layered wooden blade, a red and a black rubber sheet, and a flared ash handle with a walnut strip. There's nothing extra to download, so it loads as fast as before.
- **Your paddle is solid now.** Where it covers the ball, a soft outline of the ball shows through it, and only through it. A ball dropping behind the table stays hidden. This was checked pixel by pixel in staged scenes.
- **The rubber stays red when you tilt it towards the light.** A glossier first version washed out pink mid-swing. That's fixed.
- **The aim rings** are a deeper blue and green, edged in white, so they read on the blue table and on the pale floor.
- **Every panel kept its dark backing,** so text stays readable on the bright scene. This was checked on a laptop, and on a tablet in landscape and portrait.
- **It still runs at a steady 60 fps.** The median frame is 16.7 ms, with 0 long frames over a full match in the browser test.
- **Nothing about play changed.** All 48 game checks and 38 browser checks passed at the time.

### Scoreboard, pause, and light or dark (26 Nov)
- **The scoreboard is laid out like a broadcast graphic.**
  - You're marked in red and the opponent in blue, after the paddles' rubbers and the table.
  - An orange ball sits beside whoever is serving, games show in a small pill, and the points are large.
  - A side that wins a point glows in its colour for a moment.
  - The header shows the game number, "Deuce", "Game point" or "Match point" in the leader's colour, and who took a finished game.
- **Pause on the phone.** During a match a Pause button sits at the top of the phone page.
  - The game then waits for Resume on the phone, however steady the phone is, with End match as the other choice.
  - Playing a friend, both games stop, and the friend's screen says you paused.
- **Light and dark.**
  - Light is the daylit studio with white panels. Dark is the same room in the evening: the table stays lit and the panels turn dark.
  - Each screen follows its own device's setting until you pick one under Look on the phone. That sets both screens and is remembered.
- **Checked in the browser test:**
  - Pause shows during a match, the game stays paused while the phone keeps moving, and Resume counts back in.
  - The phone switches both screens to dark and back.
  - A friend's pause stops both games and tells the other player.

### Playing a friend online
- **How it works:** click **Play a friend online** on the first screen, or pick "A friend" from the menu once your phone is paired, and the game shows an invite link to copy or share. Your friend opens it on their own laptop or tablet and pairs their own phone. If it's their first time, they get the warm-up while you wait. Once they're ready, you pick how long to play.
- **Neither player feels the internet in their own hits.** Each laptop runs the match and judges everything on its own half of the table, including its own player's hits. The laptops swap only each hit, toss and call, and where each paddle is. Each player sees their own end nearest them.
- **The ball waits at your friend's paddle** for their hit to arrive over the internet, then catches up by running slightly fast. In simulation the wait was about one trip across the internet:

  | Delay between laptops | Typical wait | Longest wait | Their hit lands within (9 times in 10) |
  |---|---|---|---|
  | 20 ms (same city) | 25 ms | 0.08 s | 2.5 cm of the waiting ball |
  | 60 ms (same country) | 54 ms | 0.14 s | 2.7 cm |
  | 120 ms (other side of the world) | 108 ms | 0.19 s | 2.5 cm |

- **A ball your friend misses** carries on within 0.085 s. Their laptop says so 30 ms after the ball goes past their paddle. Real contacts land within 6 ms of the predicted moment 98% of the time.
- **Both laptops always agree on the score.** Simulated matches ended identically on both laptops, point by point, in these cases:
  - Delays from 15 to 120 ms.
  - Weak and strong players.
  - Every level.
  - Faults the test forced on purpose: shots into the net, long, wide and short, by either player.
- **Nothing a friend's laptop sends can break yours.** Malformed or extreme messages are ignored (tested).
- **Pausing:** if either phone drops out, both games pause and count back in together. If a friend's laptop goes quiet for over a second the match pauses, and after 8 seconds it ends and you're back at the menu.
- **Checked in a real browser** with two laptops and two phones over the real pairing service. Every step of this flow works:
  1. The invite link.
  2. The friend warming up first, with the inviter told.
  3. The lobby.
  4. A match with both scoreboards agreeing.
  5. A third laptop with the same link being turned away.
  6. Both games pausing and resuming.
  7. The inviter going back to the menu when the friend's laptop closes.
- **Friend matches don't change league points,** so two accounts can't farm wins. They're played at Club pace.
- **When two laptops can't link directly, the match goes through a relay.** Some home, mobile and office networks block a direct link. The relay is the game's own Firebase realtime database, in Singapore as the nearest region to India.
  - The friend's laptop tries a direct link for 8 seconds, then the relay for 20 more, and says what it's doing.
  - The corner badge shows "relayed" when the relay is in use.
  - PeerJS's own relay servers no longer exist: their addresses stopped resolving. That's why a friend could get stuck on "Connecting to your friend's game" on 25 Nov.
- **Tested the ways people really try it** (`npm run e2e:online`, 17 checks against a local copy of the relay database):
  - **A friend whose network blocks direct links** played a full match through the relay, with both scoreboards agreeing and both corners showing "relayed".
  - **Two tabs in one browser** link up in 1.2 s. It was 9.7 s, because the second tab waited for the first tab's pairing id.
  - **An invite link opened after its own game has closed** says so, instead of waiting forever.
  - **The relay database's rules** only allow rooms named like pairing ids, with two sides each, holding short strings. Nobody can list the rooms.

### Reliability (browser test, real pairing service)
- Pairing, the warm-up, menus, a full match, pausing when the phone goes quiet, and the countdown back in all work.
- Closing and reopening the phone page works, and the game tab can be reloaded with the phone reconnecting on its own.
- Aim speed and hold-to-recenter work.
- No errors on either page, and 0 long frames.
- No frame spends more than about 1.4 ms on game work.

### Sign-in, leaderboard and phones
- **Signing in is required to play** once Google sign-in is switched on in Firebase. Until then, or if Firebase can't be reached, the game stays open, so nobody is ever locked out. The browser test checks both cases.
- **The leaderboard is public.** It's ranked by league points: 1 per Beginner win, 3 per Club win and 6 per Pro win. The top 10 shows on the sign-in card, the top 5 plus your rank between matches, and your points in the corner.
- **The leaderboard's database rules are tested** (16 checks in the emulator):
  - Anyone can read the board, but only 50 at a time.
  - Players can write only their own record.
  - League points must match the wins.
  - Totals never go down, and at most 50 matches can be added at once.
  - Unknown fields and levels are refused.
  - Records hold a name, photo and stats, never an email.
- **Not tested with a real Google account yet** (see below).
- **Opened on a phone, the game shows a short card in the shadcn/ui style:** play on a laptop or tablet, your phone is the racket, then three steps.
  - **"Share link"** sends the game to your computer. When the phone opened a friend's invite, it sends the invite itself.
  - **"Play here anyway"** still lets you in.
  - The card follows the phone's light or dark setting. Tablets go straight in, and the phone controller page is unaffected.

### Analytics
- **Vercel Web Analytics is on,** and a real visit was confirmed recorded: https://vercel.com/shivanshsukhijas-projects/table-tennis/analytics

## What's left

### Waiting on you
1. **Create the relay database.** It takes a minute in the Firebase console, and until it's done, friends whose networks block a direct link can't play. They see "Couldn't reach your friend's game" after about 30 seconds.
   1. Open https://console.firebase.google.com/project/flickpong-game/database and click **Create Database**.
   2. Pick **Singapore (asia-southeast1)**, then **Start in locked mode**, then **Enable**.
   3. The relay's rules, in `database.rules.json`, then go up with `firebase deploy --only database --project flickpong-game`.
2. **Switch on Google sign-in.** It takes about a minute, and nothing else can do it. Sign-in becomes required to play the moment this is done:
   - https://console.firebase.google.com/project/flickpong-game/authentication/providers: Get started, then Google, then Enable, pick the support email, and Save.
   - https://console.firebase.google.com/project/flickpong-game/authentication/settings: under Authorized domains, add `flickpong.vercel.app`.
3. **Then sign in once and finish a match** to confirm your record saves. Only you can sign into your Google account.
4. **Wi-Fi.** The live session counted a freeze of 0.2–1 s about every 8 seconds, and those show as the paddle pausing. Things to try: AirDrop set to "No One" and Handoff off on the Mac, both devices on 5 GHz, or the Mac on your iPhone's Personal Hotspot.
5. **Turn off Low Power Mode on the iPhone** while playing. Its sensor dropped to 20–40 readings a second at times.
6. **Play a real friend at another place.** Simulation and the browser test can't stand in for two real people on two home connections.
7. **An old file server is still running on port 8765.** It's Python, process 92341, started on 23 Nov by an earlier session. Stop it if you don't need it: `kill 92341`.

### Known limits
- **Wi-Fi freezes over about 0.2 s** can't be hidden by any buffer.
- **Speed Insights** needs Vercel Pro (Vercel refused it on your plan). Web Analytics covers traffic.
- **iPhone vibration on hits** uses a Safari workaround that only works on iOS 18. It hasn't been verified on a real iPhone.
- **The sign-in database is in the US (`nam5`).** It's written once per match, so play isn't affected.
- **Online through the relay, every message goes by way of Singapore,** which adds delay compared with a direct link. From India that's roughly 50–100 ms each way, which the game is built to absorb. The corner badge shows the delay to your friend.
- **Online, a laptop that reloads mid-match ends the match.** Picking "A friend" again starts a new one with the same link.

### Could do next (not started)
- A "your record" screen showing wins per level.
- Anti-cheat: records are written by players' own browsers, so the rules make cheating hard but not impossible. Making it impossible needs server code (Cloud Functions), which requires Firebase's paid Blaze plan.
- A "Pro+" level once the current levels feel right on a real phone.
