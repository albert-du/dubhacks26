# Dump · dumpster.photo

Zero-login, self-destructing photo and video pools for group events. Guests scan a QR code and throw raw photos into one shared **Dumpster**. The app finds their face, texts them when new shots of them land, and ranks the best candid disasters. After 24, 48 or 72 hours, everything is deleted.

## Architecture

```
 phone (PWA) ──upload──▶ Next.js API ──original──▶ Object storage (Vultr, S3)
     ▲  ▲                     │  status: pending
     │  │ SSE                 ▼
     │  └──── MongoDB ◀── Vultr worker ──▶ Perceptron (OCR, captions, candid score, subject boxes)
     │                        │       └──▶ face-embed service (ArcFace, on Vultr)
     │                        │       └──▶ Whisper-compatible transcription
     │                        ├──▶ redaction → public WebP ──▶ storage
     │                        ├──▶ Photon 2.0 (face/mention alerts, burn digests)
     │                        ├──▶ Backboard (realtime fan-out)
     │                        └──▶ TigerData (upload velocity, cleanup audit trail)
 Photon SMS ──"create dumpster…"──▶ /api/photon/webhook
```

| Track | Where |
|---|---|
| **Perceptron** | `lib/perceptron.ts`: one grounded call per image returns OCR plus boxes, face boxes, subject boxes (used for stickers and overlays), venue/landmark text (Venue Board), and the candid score for Dumpster Fire Rank |
| **Photon 2.0** | `lib/photon.ts`, `app/api/photon/webhook`: text-to-create, batched "N new photos of you" texts, mention alerts, burn-warning digests (`lib/alerts.ts`) |
| **VEYZL** | `VEYZL.md` policy, `scripts/privacy-audit.ts`, `.github/workflows/privacy-audit.yml` |
| **MongoDB** | `lib/mongo.ts`: rooms, guests, media and AI tags, face clusters, stickers, votes. Every collection has a TTL index |
| **Vultr** | `worker/` and `services/face-embed/` run on Vultr instances; media lives in Vultr Object Storage |
| **Backboard** | `lib/backboard.ts`: realtime fan-out to stage displays. The SSE route is the always-on fallback |
| **TigerData** | `sql/tigerdata.sql`: hypertables, a continuous aggregate for uploads per minute, a cleanup queue, and the `overdue_cleanups` compliance view |

### Media pipeline (`lib/pipeline.ts`)

1. Normalize: apply EXIF rotation, cap at 2048px, strip all metadata.
2. Run Perceptron and face-embed in parallel.
3. Assign each face to a cluster (online cosine clustering).
4. Decide consent: a face is consented if its cluster is claimed by an enrolled guest.
5. Redact: pixelate and blur non-consented faces and sensitive text.
6. Write the public WebP, then notify.

It fails closed: if no scanner ran, the image isn't published.

## Run it locally

```bash
cp .env.example .env.local      # fill in what you have; everything is optional except Mongo
docker compose up -d mongo timescale   # add face-embed too (first build downloads ~300MB of models)
npm install
npm run dev                     # http://localhost:3000
npm run worker                  # second terminal: processes uploads, alerts, cleanup
```

`npm run worker` doesn't read `.env.local` by itself. Export the variables first, or run `npx tsx --env-file=.env.local worker/index.ts`.

Without API keys, the app falls back as follows:

- Photon texts are printed to the worker console.
- Backboard is skipped (SSE still works).
- TigerData metrics fall back to Mongo aggregates.
- Storage goes to `./.data/storage`.
- With `ALLOW_UNSCANNED_PUBLISH=true`, images publish without AI and show an "Unscanned" badge.

Checks: `npm run typecheck && npm test && npm run audit:privacy`.

### Simulate a Photon text

```bash
curl -X POST localhost:3000/api/photon/webhook -H 'content-type: application/json' \
  -H 'x-photon-secret: change-me' -d '{"from":"+12065550123","text":"Create dumpster \"Mt. Si Hike\" 48h"}'
```

## Integration notes: verify before demo

The adapters are isolated so that only one file per service changes:

- **Perceptron** (`lib/perceptron.ts`): assumes an OpenAI-compatible `/chat/completions` endpoint and 0–1000 box coordinates.
- **Photon** (`lib/photon.ts`, webhook route): the send endpoint and inbound payload fields are placeholders.
- **Backboard** (`lib/backboard.ts`): the publish endpoint is a placeholder.
- **VEYZL** (`.github/workflows/privacy-audit.yml`): the action reference is a TODO.

## Screens

- `/`: landing page and create form
- `/{id}`: room with tabs Drop · Pool (face filters and search, including transcripts) · Fire (rank) · Map (GPS grid and Venue Board) · Pack (stickers) · Me (selfie opt-in)
- `/{id}/stage`: projector view with a live mosaic, QR code, upload velocity and countdown
