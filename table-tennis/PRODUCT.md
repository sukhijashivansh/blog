# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Table tennis fans: people who play or follow the real sport and want a game that feels like it. They play on a laptop or tablet, with their phone in hand as the paddle.

## Product Purpose

FlickPong is table tennis in the browser against a computer opponent at three levels (Beginner, Club and Pro), or against a friend online, each at their own laptop with their own phone. Success is a match that feels like the real sport, with real spin, bounce and pace, and a paddle that answers the hand without lag.

## Positioning

Your phone is the paddle. There's no app and no controller: the game shows a QR code, the phone opens a page, and within seconds you point to aim and flick your wrist to hit.

## Operating Context

- **Two screens.** A laptop or tablet browser shows the game, and a phone browser is the controller. They pair by QR code and then talk directly over WebRTC; the PeerJS service is used only for pairing.
- **Home Wi-Fi.** Measured home Wi-Fi froze for 0.2–1 s every few seconds. The game smooths over that, but can't hide freezes that long.
- **Playing a friend.** Each player has their own laptop and phone, at their own place. The laptops connect directly over WebRTC through the same pairing service, falling back to PeerJS's relay servers. Each laptop runs the match for its own half of the table, so neither player's own hits wait on the internet.
- **Phones.** Opened on a phone, the game page asks for a bigger screen.
- **Accounts.** Google sign-in keeps each player's record and league points, and a public leaderboard ranks players. Sign-in becomes required once it is switched on in Firebase.

## Capabilities and Constraints

- **Hosting.** A static site on Vercel at flickpong.vercel.app, also served at www.shivanshsukhija.com/table-tennis/. There's no server code. Firebase (project `flickpong-game`) handles sign-in and records.
- **Speed.** The scene is three.js and must hold 60 fps on ordinary laptops. It lowers its resolution if a laptop can't keep up.
- **Security policy.** Scripts and assets load only from this site plus the named Google, Firebase and pairing hosts. New assets are copied into the project, never hotlinked.
- **Tests.** Gameplay, physics, balance and phone control are covered by `npm test`, and visual work must not change them.
- **Terms.** The levels are Beginner, Club and Pro. League points are 1 per Beginner win, 3 per Club win and 6 per Pro win. Matches against a friend are played at Club pace and earn no league points.

## Brand Commitments

- **Name:** FlickPong.
- **The look the user asked for (25 Nov 2026):** a bright, light-hearted environment with realistic wood on the table and paddles, and Apple-level polish ("like Steve Jobs"): minimal, premium materials, soft light.
- **Readability:** the game's on-screen panels must stay readable over the scene.

## Evidence on Hand

- **No proof yet.** There are no testimonials, player numbers or press. Vercel Web Analytics was switched on 25 Nov 2026 and has no data worth citing yet.
- **No brand assets** beyond the name.

## Product Principles

1. **It should feel like the real sport.** Spin, bounce, pace and paddle angle behave like table tennis.
2. **Nothing between hand and ball.** Responsiveness and smoothness come before visual effects.
3. **Forgiving where the controls can't be.** Assist hides the limits of a phone and Wi-Fi, never the sport itself.
4. **Scan and play.** No install, and no sign-in wall until sign-in actually works.
