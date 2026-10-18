# VEYZL privacy & security policy for Dump

This file is the rulebook for the VEYZL PR audit. Every PR runs two layers:

1. **Deterministic guardrails:** `npm run audit:privacy` ([scripts/privacy-audit.ts](scripts/privacy-audit.ts)) fails CI on any rule below that can be checked mechanically.
2. **VEYZL review:** `npm run audit:veyzl` ([scripts/veyzl-review.ts](scripts/veyzl-review.ts)) reads the pull request diff and fails CI on high findings: a new third-party host or action, a client-IP read, an uploader/creator/owner field, or a phone number or secret written to a log. New log lines and new store writes are reported and do not fail the check.

## Design stance

Dump is **anonymous and host-less**. Nobody owns a dumpster, nothing records who created a dumpster or who uploaded what, and everyone in a dumpster has the same powers, including deleting any photo. The privacy guarantees come from four properties: dumpsters can't be found, nothing identifies contributors, retention is short, and deletion is complete.

## Rules

| ID | Rule | Where it's enforced |
|----|------|---------------------|
| R1 | Retention is only ever 24, 48 or 72 hours. | `TTL_OPTIONS` in `lib/config.ts`; `clampTtl()` clamps unknown values to 24h |
| R2 | Every MongoDB collection has a TTL index, so data dies even if the worker is down. | `EPHEMERAL_COLLECTIONS` in `lib/mongo.ts` |
| R3 | Face vectors (`embedding`, `centroid`) never reach a browser. | `lib/serialize.ts` is the only browser-facing shaper; Mongo projections exclude vectors |
| R4 | Only public renders (`{dumpster}/public/*`) of **live** dumpsters are served. Originals can't be reached. | `app/api/files/[...key]/route.ts` |
| R5 | **Anonymity:** `Dumpster` and `Media` carry no creator, uploader, host, owner, phone or IP field, and no route reads client IPs. | `lib/types.ts`; text-to-create uses the sender's number for the one reply only |
| R6 | **Unguessable dumpsters:** dumpster ids are ≥122-bit CSPRNG ids, and malformed ids are rejected before any lookup. | `lib/dumpsters.ts` (25 chars × 32-symbol alphabet = 125 bits) |
| R7 | Selfies are embedded in memory and never stored. | `lib/enroll.ts` |
| R8 | Expiry hard-deletes blobs, media, face clusters, guest vectors, names, phones, reactions and stickers, and the dumpster's Backboard assistant, thread, and memories. | `purgeDumpster()` in `lib/cleanup.ts`, run every 60s by the worker, plus an orphaned-blob sweep. Free-text turns delete their assistant before the reply returns |
| R9 | Phone numbers are never logged in full. | `maskPhone()` |

## What is stored, and for how long

All of the following is deleted when the dumpster burns.

| Data | Why | Who it identifies |
|---|---|---|
| Photos/videos (original and public render) | The product | Whoever is in them |
| Detected objects, written text, captions, transcripts | Search and organization | — |
| Pixel hash and byte hash | Duplicate detection | — |
| Face clusters (vectors) | Face gallery and filtering | People in photos, unnamed unless they enroll |
| Guest name, phone, selfie vector | Opt-in "find me" and texts | The guest, by their own choice |
| Reactions (per-browser random id) | Toggle a reaction instead of stacking | No one: the id is a random cookie, not linked to uploads |
| Backboard assistant and thread | Ask the dump, and free-text Photon replies | No phone number and no face vector. Ask sees captions, tags, object labels, writing, transcript text, enrolled names, venue, and fire counts. A text turn is deleted before the reply is sent. Ask is deleted when the dumpster burns |

Public renders have all EXIF and location metadata stripped. GPS shown on the map is rounded to about 11 m.

## Ranking integrity

The Dumpster Fire leaderboard is computed only from people's 🔥 reactions, with other reactions as a tiebreak (`fireRank()` in `lib/reactions.ts`). No automated scoring takes part in ranking.

## Auditable deletion

- TigerData `cleanup_queue` records when each dumpster is due to burn. `cleanup_runs` records what was deleted and when.
- The `overdue_cleanups` view must be empty. Any row in it is a compliance violation.

## Known gaps (to be flagged, not hidden)

- Open moderation means any guest can delete any media. That's intended, but there's no undo or rate limit yet.
- People in photos are visible unblurred to everyone with the dumpster link. The link is the only access control.
- Browser HTTP caches may hold public renders for up to 1 hour after a burn. The service worker never caches media.
