# Pixle

A daily image-recognition puzzle. A "corrupted" image appears on a retro terminal as a handful of 1-bit
blocks. You get five guesses; every wrong guess makes the terminal run another **enhancement pass**
(more pixels, more colours) until the original is fully restored.

Built with Next.js (App Router) + TypeScript, `sharp` for image processing and SQLite (Node's built-in
driver) for puzzle data.

---

## 1. Install and run

Requires **Node.js 22.13 or newer** (developed on Node 24).

```bash
npm install
cp .env.example .env.local     # then set ADMIN_PASSWORD
npm run dev                    # http://localhost:3000
```

For production: `npm run build` then `npm start`.

Want something to look at straight away? `npm run samples` draws six sample images (original artwork,
no licence concerns) into `assets/pixle/samples/` with metadata files. They arrive as drafts like any
other image.

| Where | What |
|---|---|
| `/` | Today's puzzle |
| `/archive` | Past puzzles (practice mode) |
| `/stats` | Player statistics |
| `/admin` | Admin dashboard (password protected) |

## 2. Where to place new images

Drop JPG / JPEG / PNG / WEBP files into the content library:

```
assets/pixle/
  animals/  anime/  architecture/  food/  technology/  vehicles/  nature/  random/
```

Any sub-folder works; the folder name becomes the image's category. While the server is running the
folder is watched, so new files are picked up within a couple of seconds (opening the admin dashboard,
or pressing **Rescan folder** there, also triggers a scan). No source code changes are ever needed.

For each new image Pixle will:

1. check that it is a real, supported image,
2. hash the file — an image whose content is already registered is skipped and reported as a duplicate,
3. give it a puzzle ID,
4. render the five stages into `storage/pixle/processed/<id>/` and a thumbnail into
   `storage/pixle/thumbnails/` (your original file is never modified),
5. register it as a **draft**. Nothing is ever published automatically.

You can also upload from the dashboard (single or bulk, drag & drop); uploads are saved into the same
folder. Renaming or moving a file is detected and keeps its metadata.

> The library lives outside `public/` on purpose: anything in `public/` can be downloaded by URL, which
> would let players fetch the un-pixelated original. Images are only served through an API that checks
> which stage each player has unlocked.

## 3. Adding metadata

**In the dashboard:** `/admin` → click an image → fill in the form (answer, accepted alternatives,
theme, hint, difficulty, source URL, creator, licence) → **Save**.

**Or with a sidecar file** next to the image, read once when the image is first imported — handy for
preparing a batch offline. For `tiger.jpg`, create `tiger.jpg.json` (or `tiger.json`):

```json
{
  "answer": "Tiger",
  "accepted": ["bengal tiger", "big cat"],
  "theme": "Animals",
  "hint": "Wildlife",
  "difficulty": "easy",
  "sourceUrl": "https://example.com/photo",
  "creator": "Jane Doe",
  "licence": "CC BY 4.0"
}
```

Images without an answer and a hint are flagged **Needs config** and cannot be approved.

Answer checking ignores case, punctuation, accents, extra spaces and a leading "a/an/the". It is an
exact match against the answer or one of the alternatives — there is no fuzzy matching, so list the
aliases you want to accept.

## 4. Approving assets

Open the asset → **Save & approve**. Only approved assets can be scheduled. Use **Preview as player**
first to test-play it exactly as players will see it (previews are never recorded).
**Return to draft**, **Archive** and **Delete** are on the same screen; delete also removes the original
file. Assets that have been on the schedule can be archived but not deleted.

## 5. Scheduling daily puzzles

`/admin/schedule` shows a month calendar:

- click any day from today onwards and pick an approved puzzle (fresh, never-scheduled ones are listed first),
- **Auto-fill empty days** assigns unscheduled approved puzzles to the remaining gaps in the month,
- past days are locked and marked as used; changing *today's* puzzle restarts it for players.

You can also schedule from an asset's own page. If a day has no puzzle, players see a "No case today"
screen with a countdown rather than an error.

The day rolls over at midnight in the configured timezone (default `Australia/Melbourne`). The server
decides the date, so players cannot reach future puzzles by changing their clock.

## 6. Accessing the admin dashboard

Go to `/admin` and sign in with the password from `ADMIN_PASSWORD` in `.env.local`. Sessions last
12 hours. Without a password set, sign-in is disabled. Use HTTPS in production (the session cookie is
marked `Secure` there).

## 7. Scoring and pixelation settings

Edit `pixle.config.json` in the project root. Changes apply on the next request — no rebuild.

```json
{
  "timezone": "Australia/Melbourne",
  "launchDate": null,
  "scoring": { "points": [500, 400, 300, 200, 100], "hintPenalty": 50 },
  "pixelation": {
    "outputSize": 960,
    "stages": [
      { "blocks": 14, "levels": 2, "mono": true },
      { "blocks": 22, "levels": 2, "mono": false },
      { "blocks": 36, "levels": 3, "mono": false },
      { "blocks": 80, "levels": 4, "mono": false }
    ]
  }
}
```

- `points` — score for solving on guess 1–5. `hintPenalty` is subtracted if the hint was used (never below 0).
- `stages` — the four enhancement passes before the original (stage 5). `blocks` is the number of
  pixels along the image's longer side, `levels` the colour levels per channel after dithering
  (2 = 8 colours), `mono` renders the pass in pure 1-bit.
- `launchDate` — the date of puzzle #1 (`"YYYY-MM-DD"`). `null` uses the first scheduled date.
- After changing pixelation, press **Rescan folder** in the dashboard (or restart) and every image is
  re-rendered.
- A single image can override the `blocks` values on its admin page ("Pixel grid per pass").

## How the game works

- Five guesses, five stages. Stage 1 is shown before the first guess; each wrong guess reveals the next
  stage, so the fifth and final guess is made on the fully restored image. After a fifth miss the
  answer is shown.
- The hint is optional, costs points, never costs a guess, and stays visible once revealed.
- Repeating a guess you already made is not counted.
- Progress is stored on the server against an anonymous player ID (an httpOnly cookie), so refreshing
  cannot reset an attempt and the answer never reaches the browser before the game ends.
- Statistics and streaks count daily games only. Archive (practice) games and admin previews never
  affect them.

## Data and backups

| Path | Contents | Safe to delete? |
|---|---|---|
| `assets/pixle/` | Your original images | No — this is your content |
| `data/pixle.db` | Metadata, schedule, players, plays | No — back this up |
| `storage/pixle/` | Generated stages and thumbnails | Yes — it is rebuilt |

`data/` and `storage/` are git-ignored. If `storage/` is deleted, the next folder scan (server start or
**Rescan folder**) regenerates it from the originals.

Players are anonymous today, but every play is already a server-side row keyed by player ID
(`players` / `plays` tables), so accounts and leaderboards can be added by attaching identity to
`players` without changing how games are recorded.

Pixle needs a host with a persistent disk and a long-running Node process (a VPS, Railway, Fly.io,
Render…). It will not work on serverless platforms with read-only or ephemeral file systems.
