# Dump

Dump is one shared photo pile for a group. A party, a hike, a wedding, a tailgate. Someone opens a dumpster, passes the link or the QR code, and everyone throws in what they shot. You get in from that link. There is no sign-in.

The pile lasts 24, 48, or 72 hours. Then the photos, the videos, the names, and the phone numbers are deleted.

A dumpster has no owner. Nothing records who opened it or who uploaded a shot. Anyone with the link can take a shot back out. People in the photos are visible to everyone who has the link. The link is the lock.

## Start one

On the home page, name the dumpster and pick how long it lasts. You can leave videos on, or make it photos only. Dump hands back a link and a QR code. Tape the code up, or send the link to the group chat.

If a text number is set (`NEXT_PUBLIC_PHOTON_NUMBER`), the home page also shows that number. Text it:

```text
create dumpster "Mt. Si Hike" 48h
```

Hours are only 24, 48, or 72. Anything else becomes 24. `help` lists the commands. A dumpster opened by text accepts photos and videos.

With Backboard configured, a looser text works too, such as "open one for the hike, two days". Paste a dumpster link and the reply tells you how many shots are in it, how many fires the top shot has, and when it burns.

## On a phone

A dumpster is six tabs along the bottom.

**Drop.** Throw in photos, and videos when this dumpster allows them. If the signal dies, the phone keeps the files and sends them when it comes back. The same screen has the QR code, the copy-link button, and a link to the big-screen view.

**Dump.** The pile. Faces from the photos sit across the top. Tap a person to see their shots. Tap **+ name** under a face to name it (anyone can, and anyone can fix it). Type to filter. A word has to show up in the picture, on a sign, in something someone said, in a face's name, or in a place. Every word in the box has to match. Or tap the camera next to the search box and search with a photo: a face finds that person's shots, anything else finds shots with the same things in them. The search photo is not kept. Tap **Select** to pick shots and save them. One saves directly; several come down as a zip. The same photo uploaded twice stays hidden until you tap to show the dupes. All shots is a grid. Moments groups shots taken within about 20 minutes and 250 meters of each other, and names the group from the place or the tags.

**Fire.** The leaderboard. Open a shot and tap the flaming can. The shot with the most fires is on top. Hearts, laughs, and the other reactions only break a tie. The order comes from those taps.

**Map.** Moments that have a location, drawn on a plain grid. Nothing is sent to a map company. Pins with a fire on them are marked. Under the map, the venue board lists places read off signs and landmarks. Tap a place to jump back to those shots in the dump.

**Pack.** Stickers cut out of a photo. Open a shot, tap Sticker, and pick an object or the whole frame. Press and hold a finished sticker to save it.

**Me.** Texts are off until you turn them on. Then Dump asks for a phone number and a selfie. The selfie is used once to find your face and is not kept. Dump texts you when new photos of you land, and when a video says the name on your face. Stop texts any time; that forgets the number and the face match. Those texts are batched, about a minute and a half apart. About two hours before the dumpster burns, everyone who left a number gets one warning and a link, so they can save what they want.

Open a shot to see who is in it, what was recognized, any writing, and any words from a video. From there you can react, save a copy, cut a sticker, or delete it for everyone.

If Ask is on, the Dump search box grows an Ask button. Ask answers the sentence and shows the shots it means. The word filter still works either way. Ask only appears when `BACKBOARD_API_KEY` is set. The key stays on the server.

## On a screen at the venue

Open `/your-dumpster-id/stage` on a TV or a projector. It shows the newest photos, a QR code to join, how many shots are in the pile, how many people have been found, the fire total, drops per minute, the countdown, and the current top fire.

## When it burns

At the end of the timer, the worker deletes that dumpster's files, face data, names, phone numbers, reactions, stickers, and Ask assistant. The link starts showing a burned page. Mongo also expires the records on its own, so they go away even if the worker is down. A browser may keep a public image in its cache for up to an hour. The service worker does not cache photos.

## Run it locally

```bash
cp .env.example .env.local
docker compose up -d mongo timescale
npm install
npm run dev
npm run worker
```

The site is at http://localhost:3000. Run the worker in a second terminal. It sorts uploads, sends texts, and deletes expired dumpsters. It reads `.env.local` when that file exists. Variables already set in the environment win.

Face matching is a separate service. The first build downloads the models, about 300MB:

```bash
docker compose up -d face-embed
```

You can click through the app with no API keys.

- Photos still publish. Captions, writing, and object tags show up once Perceptron is set. Faces group once face-embed is running.
- Texts print in the worker console. A text that is not the create command gets the command list.
- Search stays a word filter. The Ask button stays hidden.
- Drops per minute come from Mongo.
- Files land in `./.data/storage`.

Checks:

```bash
npm run typecheck && npm test && npm run audit:privacy && npm run audit:veyzl
```

`npm run brand` rebuilds the logo files from the SVGs in the repo root.

Try a text locally. The secret below matches `PHOTON_WEBHOOK_SECRET` in `.env.example`.

```bash
curl -X POST localhost:3000/api/photon/webhook -H "content-type: application/json" \
  -H "x-photon-secret: change-me" -d "{\"from\":\"+12065550123\",\"text\":\"Create dumpster \\\"Mt. Si Hike\\\" 48h\"}"
```

Live texts arrive as Photon `message.received` events, signed as Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`). The reply goes back in that same conversation. The sender's number is used for that one reply and is not stored.

## What you can turn on

Each of these is optional. The app runs without them. The comments in `.env.example` name the variables.

| Piece | What it adds |
|---|---|
| Perceptron | Looks at each photo: objects and people, writing, a caption, tags, and a venue name. One Mk1.5 chat completion. Boxes come back as `<point_box>` markup. If it is down, the photo still publishes. |
| Face embed | Groups faces and matches a selfie. Vectors stay on the server. |
| Transcription | Any Whisper-compatible endpoint. This is how video search and "your name was mentioned" texts work. |
| Photon 2.0 | Creates a dumpster by text, and sends photo alerts, mention alerts, and the burn warning. Needs the API key, the project id, and the agent user id. A shared iMessage line only delivers after that person has texted the bot. Cold alerts need SMS or a line of their own. |
| Backboard | Ask the dump, and texts that are not a fixed command. One assistant per dumpster, deleted when the dumpster burns. A loose text uses a throwaway assistant that is deleted before the reply goes out. New photos still arrive on the site's own live feed. |
| TigerData | Drops per minute, and a record of each cleanup. Without it, those numbers come from Mongo. |
| Object storage | Vultr in production. A folder on disk locally. |

The privacy rules for reviewers are in `VEYZL.md`. CI runs the privacy check and the VEYZL diff review on every pull request and on pushes to main.
