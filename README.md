# Dump · dumpster.photo

One shared, self-destructing photo and video pile for group events.

- Guests open a random, unguessable link or scan a QR code and drop what they shot.
- Every person in the photos gets a face filter, and the pile can be searched by what's in the shots, what's written on signs, and what's said in videos.
- Photos group themselves into moments, and the crowd picks the best disasters with 🔥 reactions.
- After 24, 48 or 72 hours, everything is deleted.

Dumpsters are anonymous and have no hosts. Nobody owns a dumpster, nothing records who made it or who uploaded what, and anyone in a dumpster can delete anything.

## Architecture

```
 phone (PWA) ──upload──▶ Next.js API ──original──▶ Object storage (Vultr, S3)
     ▲                        │  status: pending
     │ SSE                    ▼
     └──── MongoDB ◀── Vultr worker ──▶ Perceptron (objects + people, OCR text, captions, venue)
                              │       └──▶ face-embed service (ArcFace, on Vultr)
                              │       └──▶ Whisper-compatible transcription
                              ├──▶ pixel hash + duplicate check → public WebP → storage
                              ├──▶ Photon 2.0 (face/mention alerts, burn digests, free-text replies)
                              ├──▶ Backboard (ask the pool, free-text commands)
                              └──▶ TigerData (upload velocity, cleanup audit trail)
 Photon SMS ──"create dumpster…"──▶ /api/photon/webhook
```

| Track | Where |
|---|---|
| **Perceptron** | `lib/perceptron.ts`: one Mk1.5 chat completion per image returns every primary object and person with boxes (tags, stickers, overlays), all legible text (OCR search), captions and venue text (Venue Board) |
| **Photon 2.0** | `lib/photon.ts` and `app/api/photon/webhook`: text-to-create, batched "N new photos of you" texts, video-mention alerts, burn-warning digests (`lib/alerts.ts`) |
| **VEYZL** | `VEYZL.md` policy (anonymity, unguessable ids, retention, complete deletion), `scripts/privacy-audit.ts`, `.github/workflows/privacy-audit.yml` |
| **MongoDB** | `lib/mongo.ts`: dumpsters, guests, media and detections, face clusters, stickers, reactions. Every collection has a TTL index |
| **Vultr** | `worker/` and `services/face-embed/` run on Vultr instances; media lives in Vultr Object Storage |
| **Backboard** | `lib/backboard.ts`: Ask the pool (`lib/ask.ts`) and Photon texts that aren't a fixed command (`lib/texts.ts`). One assistant per dumpster, deleted with its thread and memories on purge. The SSE route stays the live feed |
| **TigerData** | `sql/tigerdata.sql`: hypertables, a continuous aggregate for drops per minute, a cleanup queue, and the `overdue_cleanups` compliance view |

### How media gets organized

| Feature | Code | How |
|---|---|---|
| Duplicates | `lib/dedupe.ts` | Byte hash for everything, plus a 64-bit pixel hash checked against camera timestamps for images. Duplicates are flagged and hidden behind a toggle |
| Moments | `lib/moments.ts` | Shots within 20 minutes and 250 m of each other become one moment, labeled by venue or tag |
| Faces | `lib/pipeline.ts`, `lib/enroll.ts` | Online cosine clustering into a face gallery. A guest's selfie names their cluster and turns on texts |
| Search | `lib/search.ts`, `lib/ask.ts` | Every query word must match somewhere across objects, written text, speech, people, places and tags. With `BACKBOARD_API_KEY`, Ask answers a sentence and filters to those shots |
| Dumpster Fire | `lib/reactions.ts` | Ranked only by 🔥 reactions, with other emoji as a tiebreak. No automated scoring |

## Run it locally

```bash
cp .env.example .env.local
docker compose up -d mongo timescale   # add face-embed too (first build downloads ~300MB of models)
npm install
npm run dev                            # http://localhost:3000
npm run worker                         # second terminal: processing, alerts, cleanup
```

`npm run worker` loads `.env.local` when that file exists. Variables already set in the environment win.

Without API keys, everything still runs:

- Photos publish without detections.
- Photon texts print to the worker console. Texts that aren't the create command get the command list.
- Ask stays a word search.
- Metrics fall back to Mongo.
- Storage goes to `./.data/storage`.

Checks: `npm run typecheck && npm test && npm run audit:privacy`. Brand assets are regenerated from the root SVGs with `npm run brand`.

### Simulate a Photon text

```bash
curl -X POST localhost:3000/api/photon/webhook -H 'content-type: application/json' \
  -H 'x-photon-secret: change-me' -d '{"from":"+12065550123","text":"Create dumpster \"Mt. Si Hike\" 48h"}'
```

Live deliveries are Photon `message.received` events, signed as Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`) with `PHOTON_WEBHOOK_SECRET`. The handler replies in that event's space.

## Integration notes: verify before demo

- **Perceptron** (`lib/perceptron.ts`): `POST /v1/chat/completions` with model `perceptron-mk1.5`, `vision_config.annotation_format` set to `box`, and an inline JPEG data URL. Boxes are `<point_box>` markup on a 0–1000 grid inside `choices[0].message.content`, stored as 0–1. `isaac-0.1` is retired and returns 404. `/v1/detect` returns pixel coordinates and is not used.
- **Photon 2.0** (`lib/photon.ts`, webhook route): outbound text creates or reuses a User and a Space, then `POST /v1/projects/{id}/messages` with `{ spaceId, senderId, content: { type: "text", format: "plain", text } }`. Set `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `PHOTON_AGENT_USER_ID`, and `PHOTON_PLATFORM`. A shared iMessage line only delivers after that person has texted the agent; cold photo alerts and burn warnings need SMS or a dedicated line.
- **Backboard** (`lib/backboard.ts`): `POST /threads/messages` and `POST /threads/tool-outputs` with `X-API-Key`. Base URL defaults to `https://app.backboard.io/api`. Ask keeps an assistant named `dumpster-{id}` until purge, which `DELETE`s its memories and the assistant. A free-text Photon turn uses a `dump-text-*` assistant that is deleted before the reply returns.
- **VEYZL** (`.github/workflows/privacy-audit.yml`): the action reference is a TODO.

## Screens

Built for portrait phones 375–430px wide.

- `/`: start a Dumpster.
- `/{id}`: the dumpster, with these tabs:
  - **Drop:** upload.
  - **Pool:** face gallery, search, all shots or moments.
  - **Fire:** the leaderboard.
  - **Map:** moments and the Venue Board.
  - **Pack:** stickers.
  - **Me:** selfie and texts.
- `/{id}/stage`: a big-screen view with a live mosaic, QR code, drops per minute and the countdown.
