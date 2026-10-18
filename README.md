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
                              ├──▶ Photon 2.0 (face/mention alerts, burn digests)
                              ├──▶ Backboard (realtime fan-out)
                              └──▶ TigerData (upload velocity, cleanup audit trail)
 Photon SMS ──"create dumpster…"──▶ /api/photon/webhook
```

| Track | Where |
|---|---|
| **Perceptron** | `lib/perceptron.ts`: one grounded call per image returns every primary object and person with boxes (tags, stickers, overlays), all legible text (OCR search), captions and venue text (Venue Board) |
| **Photon 2.0** | `lib/photon.ts` and `app/api/photon/webhook`: text-to-create, batched "N new photos of you" texts, video-mention alerts, burn-warning digests (`lib/alerts.ts`) |
| **VEYZL** | `VEYZL.md` policy (anonymity, unguessable ids, retention, complete deletion), `scripts/privacy-audit.ts`, `.github/workflows/privacy-audit.yml` |
| **MongoDB** | `lib/mongo.ts`: dumpsters, guests, media and detections, face clusters, stickers, reactions. Every collection has a TTL index |
| **Vultr** | `worker/` and `services/face-embed/` run on Vultr instances; media lives in Vultr Object Storage |
| **Backboard** | `lib/backboard.ts`: realtime fan-out to stage displays. The SSE route is the always-on fallback |
| **TigerData** | `sql/tigerdata.sql`: hypertables, a continuous aggregate for drops per minute, a cleanup queue, and the `overdue_cleanups` compliance view |

### How media gets organized

| Feature | Code | How |
|---|---|---|
| Duplicates | `lib/dedupe.ts` | Byte hash for everything, plus a 64-bit pixel hash checked against camera timestamps for images. Duplicates are flagged and hidden behind a toggle |
| Moments | `lib/moments.ts` | Shots within 20 minutes and 250 m of each other become one moment, labeled by venue or tag |
| Faces | `lib/pipeline.ts`, `lib/enroll.ts` | Online cosine clustering into a face gallery. A guest's selfie names their cluster and turns on texts |
| Search | `lib/search.ts` | Every query word must match somewhere across objects, written text, speech, people, places and tags. Results show where each match came from |
| Dumpster Fire | `lib/reactions.ts` | Ranked only by 🔥 reactions, with other emoji as a tiebreak. No automated scoring |

## Run it locally

```bash
cp .env.example .env.local
docker compose up -d mongo timescale   # add face-embed too (first build downloads ~300MB of models)
npm install
npm run dev                            # http://localhost:3000
npx tsx --env-file=.env.local worker/index.ts   # second terminal: processing, alerts, cleanup
```

Without API keys, everything still runs:

- Photos publish without detections.
- Photon texts print to the worker console.
- Metrics fall back to Mongo.
- Storage goes to `./.data/storage`.

Checks: `npm run typecheck && npm test && npm run audit:privacy`. Brand assets are regenerated from the root SVGs with `npm run brand`.

### Simulate a Photon text

```bash
curl -X POST localhost:3000/api/photon/webhook -H 'content-type: application/json' \
  -H 'x-photon-secret: change-me' -d '{"from":"+12065550123","text":"Create dumpster \"Mt. Si Hike\" 48h"}'
```

## Integration notes: verify before demo

- **Perceptron** (`lib/perceptron.ts`): assumes an OpenAI-compatible `/chat/completions` endpoint and 0–1000 box coordinates.
- **Photon** (`lib/photon.ts` and the webhook route): the send endpoint and inbound payload fields are placeholders.
- **Backboard** (`lib/backboard.ts`): the publish endpoint is a placeholder.
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
