# Uno

Uno for phones and desktops. Hot-seat for 2 to 4 players, against a bot, or online in a room with a four-letter code. No accounts, no database, no dependencies.

Live at https://uno.ianmcmanus.net

## Rules

- Everyone starts with 7 cards. Play a card that matches the top card by colour or by number or symbol.
- Can't play, or don't want to? Draw one card. If it fits you may play it, otherwise pass.
- Skip loses the next player's turn. Reverse changes direction (a skip with two players). Draw Two makes the next player draw two and miss a turn.
- Wild picks the colour. Wild Draw Four also makes the next player draw four and miss a turn, and can only be played with no card of the current colour.
- Call Uno with the Uno! button before you play your second to last card, or right after. If another player taps Catch before the next move, you draw two.
- First to play their last card wins. The end screen counts the points left in the other hands: numbers face value, action cards 20, wilds 50.

Hot-seat play hides each hand behind a "pass the device" screen. In a game against the bot, the bot catches you if you forget to call Uno, and sometimes forgets itself.

## Online play

Create a room, share the code or the invite link, and the host starts the game once 2 to 4 players are in. The server owns the deck and enforces turns. Clients send actions (`play`, `draw`, `pass`, `uno`, `catch`) and receive their own view over Server-Sent Events: their hand, the other players' card counts, and the top of the discard pile. Hands and the draw order never leave the server until the game ends. Each player has a random action token and a separate read-only stream token. Rooms live in memory, expire after two hours idle, and are lost on restart.

| Route | Purpose |
| --- | --- |
| `POST /api/rooms` | Create a room. Returns `{ code, token, watch }`. |
| `POST /api/rooms/:code/join` | Join a room. Returns `{ token, watch }`. |
| `POST /api/rooms/:code/start` | Host starts the game (`x-token` header). |
| `POST /api/rooms/:code/act` | Play an action (`x-token` header). |
| `GET /api/rooms/:code/events?watch=` | Event stream of the player's view. |
| `GET /healthz` | Returns `ok`. |

Behind a reverse proxy, turn off response buffering for the event stream (`proxy_buffering off`).

## Run it

Node 22 or newer, nothing to install.

```bash
npm start
```

Serves on http://localhost:8080 (`PORT` changes it). With Docker:

```bash
docker build -t uno .
docker run -p 8080:8080 uno
```

## Tests

```bash
npm test
```

## Structure

| Path | What it does |
| --- | --- |
| `site/game.js` | Deck, legal plays, effects, Uno calls and catches, per-player views. Pure functions. |
| `site/bot.js` | Bot: plays the most useful legal card and picks the colour it holds most. |
| `site/app.js` | Screens, rendering, hot-seat cover screen, bot driver. |
| `site/online.js` | Online client: lobby, invite link, event stream, reconnect. |
| `site/sw.js`, `site/manifest.webmanifest` | Installable PWA; hot-seat play works offline. |
| `server/rooms.js` | In-memory room store; runs `game.js` as the referee. |
| `server/server.js` | Static files, room API, event stream, rate limits, CSP and `/healthz`. |

The page is a PWA. Bump `CACHE` in `site/sw.js` on every deploy that changes static files.

"Uno" is a trademark of Mattel. This is an unofficial fan project and is not affiliated with them.

## License

The font in `site/fonts/` is JetBrains Mono under the SIL Open Font License; see `site/fonts/OFL.txt`. No license has been chosen for the rest of the code yet.
