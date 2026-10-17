# VEYZL privacy & security policy for Dump

This file is the rulebook for the VEYZL PR audit. Every PR runs two layers:

1. **Deterministic guardrails:** `npm run audit:privacy` ([scripts/privacy-audit.ts](scripts/privacy-audit.ts)). It fails CI on any rule below that can be checked mechanically.
2. **VEYZL review:** an automated reviewer reads the diff against this policy and flags anything the script can't prove, such as new data flows, new logs, or new third-party calls.

## Rules

| ID | Rule | Where it's enforced |
|----|------|---------------------|
| R1 | Retention is only ever 24, 48 or 72 hours. | `TTL_OPTIONS` in `lib/config.ts`; Photon parser clamps unknown values to 24h |
| R2 | Every MongoDB collection has a TTL index, so data dies even if the worker is down. | `EPHEMERAL_COLLECTIONS` in `lib/mongo.ts` |
| R3 | Face vectors (`embedding`, `centroid`) never reach a browser. | `lib/serialize.ts` is the only browser-facing shaper; Mongo projections exclude vectors |
| R4 | Only redacted renders (`{room}/public/*`) of **live** rooms are served. Originals can't be reached. | `app/api/files/[...key]/route.ts` |
| R5 | Non-consented faces and sensitive text are blurred **by default**. | `createDumpster()` defaults |
| R6 | Fail closed: an image no face scanner has checked is never published (outside dev). | `processImage()` in `lib/pipeline.ts` |
| R7 | Selfies are embedded in memory and never stored. | `lib/enroll.ts` |
| R8 | Expiry hard-deletes blobs, media, clusters, guest vectors, phones, votes and stickers. | `purgeDumpster()` in `lib/cleanup.ts`, run every 60s by the worker plus an orphan sweep |
| R9 | Phone numbers are never logged in full. | `maskPhone()` |

## Consent model

- A face is **consented** only if its cluster has been claimed by a guest who enrolled with a selfie and ticked the consent box.
- When someone enrolls, photos they already appear in are re-rendered without their blur. Everyone else stays blurred.
- When blurring is on, face filter avatars only show consented people. An anonymous avatar would leak the face we just blurred.
- Redaction is pixelate + blur on a padded box. It can't be reversed from the output, and outputs carry no EXIF.
- Public GPS is rounded to 4 decimal places (about 11 m).

## Auditable deletion

- TigerData `cleanup_queue` records when each room is due to burn. `cleanup_runs` records what was deleted and when.
- The `overdue_cleanups` view must be empty. Any row in it is a compliance violation.

## Known gaps (to be flagged, not hidden)

- **Video frames are not face-redacted.** Hosts opt in with `settings.allowVideo`, and the UI says so.
- Browser HTTP caches may hold public renders for up to 1 hour after a burn (`Cache-Control: private, max-age=3600`). The service worker never caches media.
- Transcripts are stored in plain text until expiry.
