# VEYZL privacy & security policy for dump

This file is the rulebook for the VEYZL PR audit. Every PR runs two layers:

1. **Deterministic guardrails:** `npm run audit:privacy` ([scripts/privacy-audit.ts](scripts/privacy-audit.ts)) fails CI on any rule below that can be checked mechanically.
2. **VEYZL review:** `npm run audit:veyzl` ([scripts/veyzl-review.ts](scripts/veyzl-review.ts)) reads the pull request diff and fails CI on high findings: a new third-party host or action, a client-IP read, an uploader/creator/owner field, or a phone number or secret written to a log. New log lines and new store writes are reported and do not fail the check.

## Design stance

dump is **account-free and host-less**. To use a dumpster you sign in to that one dumpster: a name and a selfie the first time, and the name alone after that. There are no accounts and the sign-in burns with the dumpster. Nobody owns a dumpster, nothing records who created a dumpster or who uploaded which photo, and everyone signed in has the same powers, including deleting any photo. The privacy guarantees come from four properties: dumpsters can't be found, uploads aren't tied to people, retention is short, and deletion is complete.

## Rules

| ID | Rule | Where it's enforced |
|----|------|---------------------|
| R1 | Retention is only ever 24, 48 or 72 hours. | `TTL_OPTIONS` in `lib/config.ts`; `clampTtl()` clamps unknown values to 24h |
| R2 | Every MongoDB collection has a TTL index, so data dies even if the worker is down. | `EPHEMERAL_COLLECTIONS` in `lib/mongo.ts` |
| R3 | Face vectors (`embedding`, `centroid`) never reach a browser. | `lib/serialize.ts` is the only browser-facing shaper; Mongo projections exclude vectors |
| R4 | Only public renders (`{dumpster}/public/*`) of **live** dumpsters are served. Originals can't be reached. | `app/api/files/[...key]/route.ts` |
| R5 | **No creator or uploader identity:** `Dumpster` and `Media` carry no creator, uploader, host, owner, phone or IP field, and no route reads client IPs. Sign-in names live only on expiring guest records. | `lib/types.ts`; text-to-create uses the sender's number for the reply only; explicit alert connections live on expiring guest records |
| R6 | **Unguessable dumpsters:** dumpster ids are ≥122-bit CSPRNG ids, and malformed ids are rejected before any lookup. | `lib/dumpsters.ts` (25 chars × 32-symbol alphabet = 125 bits) |
| R7 | Selfies and search-by-photo images are analyzed in memory and never stored. | `lib/enroll.ts`, `lib/photoSearch.ts` |
| R8 | Expiry hard-deletes blobs, media, face clusters, guest vectors, names, phones, reactions and stickers, and the dumpster's Backboard assistant, thread, and memories. | `purgeDumpster()` in `lib/cleanup.ts`, run every 60s by the worker, plus an orphaned-blob sweep. Free-text turns delete their assistant before the reply returns |
| R9 | Phone numbers are never logged in full. | `maskPhone()` |

## What is stored, and for how long

All of the following is deleted when the dumpster burns.

| Data | Why | Who it identifies |
|---|---|---|
| Photos/videos (original and public render) | The product | Whoever is in them |
| Detected objects, written text, captions, transcripts | Search and organization | — |
| Pixel hash and byte hash | Duplicate detection | — |
| Face clusters (vectors) and optional face names | Face gallery, filtering, mention texts | People in photos. A name appears only if someone in the dumpster adds one |
| Guest name and selfie vector | Sign-in to one dumpster; names their face | The guest. Deleted on Forget me or burn. Sign out only drops this browser |
| Guest verified phone, iMessage conversation routing, pending connection-code hash | Opt-in texts; codes expire after ten minutes | The guest, by their own choice. Routing and codes stay server-side. Deleted on disconnect, Forget me, or burn |
| Search-by-photo query image | Photo search | Never stored. Analyzed in memory for the one request |
| Reactions (per-browser random id) | Toggle a reaction instead of stacking | No one: the id is a random cookie, not linked to uploads |
| Backboard assistant and thread | Ask the dump, and free-text Photon replies | No phone number and no face vector. Ask sees captions, tags, object labels, writing, transcript text, face names, venue, and fire counts. A text turn is deleted before the reply is sent. Ask is deleted when the dumpster burns |

Public renders have all EXIF and location metadata stripped. GPS shown on the map is rounded to about 11 m.

## Ranking integrity

The Dumpster Fire leaderboard is computed only from people's 🔥 reactions, with other reactions as a tiebreak (`fireRank()` in `lib/reactions.ts`). No automated scoring takes part in ranking.

## Auditable deletion

- TigerData `cleanup_queue` records when each dumpster is due to burn. `cleanup_runs` records what was deleted and when.
- The `overdue_cleanups` view must be empty. Any row in it is a compliance violation.

## Known gaps (to be flagged, not hidden)

- Open moderation means any guest can delete any media. That's intended, but there's no undo or rate limit yet.
- A name is the only thing needed to sign back in. Anyone with the link who types a name already signed in here becomes that guest: their face match, and their alert connection (they can disconnect it or point it at their own number). No phone number or vector is revealed. This matches the stance that the link is the lock.
- A first sign-in's selfie is checked against the pile before it is saved. If it looks like a signed-in guest, the browser is told that guest's name, so anyone with the link can learn which name a face belongs to. That name is already on the face in the gallery. The selfie is still analyzed in memory and not kept.
- Anyone signed in can rename a face to someone's signed-in name and confirm "same person", which moves that face group to them. Renaming yourself in Me to a signed-in name and confirming merges your sign-in into theirs (phones, faces, and a verified text connection if they have none). Like deleting a shot or a sticker, this is open moderation with no undo. Hiding a face can be undone from the dump's hidden list.
- People in photos are visible unblurred to everyone with the dumpster link. The link is the only access control.
- Browser HTTP caches may hold public renders for up to 1 hour after a burn. The service worker never caches media.
- The map tab loads OpenFreeMap vector tiles for the area around shots. A tile request tells OpenFreeMap that area. It is the same rounded GPS already shown to anyone with the dumpster link. No dumpster id, photo, or account is sent.
