# Production deployment

Run these commands from the repository root on a host with Docker Engine and
Docker Compose v2. This is a separate stack from the development Compose file.
It runs the Next.js app, background worker, CPU face embedding service, and
CPU Whisper transcription service (Speaches).
MongoDB must be provided externally (for example, Atlas); hosted Timescale is optional.

```bash
cp deploy/.env.example deploy/.env
# Edit deploy/.env before continuing.
docker compose --env-file deploy/.env -f deploy/compose.yml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yml ps
docker compose --env-file deploy/.env -f deploy/compose.yml logs -f web worker
```

Set `NEXT_PUBLIC_APP_URL` to the public HTTPS origin and `MONGODB_URI` to an
authenticated database URI reachable from the host. Allow the host's outbound IP
in your managed database network rules. Set a random `CRON_SECRET` and
configure the Photon-provided `PHOTON_WEBHOOK_SECRET` signing secret before using
the inbound webhook. Configure Perceptron for objects, people, text, and captions.
Analysis is enrichment: photos still publish when vision services are unavailable.
The former `ALLOW_UNSCANNED_PUBLISH` setting is no longer used.

Photon 2.0 requires `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, and
`PHOTON_PLATFORM=imessage`. The key needs `project:read`, `project:write`,
`platforms:read`, and `platforms:write`. The API base defaults to `https://api.photon.codes/v1`.
Register the public `/api/photon/webhook` URL with Photon, subscribe it to
`message.received`, and copy its Standard Webhooks signing secret into
`PHOTON_WEBHOOK_SECRET`. Public HTTPS must work before testing replies.

The homepage registers fresh numbers through Photon and reuses existing assignments.
Photon enforces the 25-slot project allowance atomically; when full, the homepage
explains that link/QR joining still works. Sending the create text opens the Dumpster. Anyone can join an existing link or QR code.

In Me, guests save their name, then optionally connect alerts by sending a
one-time message from their registered number. The code is hashed, expires after
ten minutes, and is consumed atomically. Alerts use that guest's verified
conversation and agent, never a global sending line. Unregistered guests retain
website access. Profile edits preserve connections; changing the number requires
new verification, and disconnecting removes routing and contact data. All of this
state lives on the expiring guest record. Failed sends retain pending alerts;
expiry reminders retry the same saved payload and idempotency key.

`PHOTON_AGENT_USER_ID` is an optional fallback for manual sends and the local
simulator. `NEXT_PUBLIC_PHOTON_NUMBER` is no longer used. Shared iMessage sends
include `parentMessageId` when it is the inbound message the phone already sent,
so the shared line can deliver the reply. A 409 on that thread is retried once
in the same Space without a parent.

Backboard now powers Ask the pool and free-text Photon replies. Set
`BACKBOARD_API_KEY` to enable it; `BACKBOARD_URL` defaults to
`https://app.backboard.io/api`. Without a key, search and fixed Photon commands
still work. Live photo updates use SSE independently of Backboard.

For Cloudflare R2, set `S3_REGION=auto`, the account's S3 API endpoint without a
bucket path, the bucket name, and bucket-scoped Object Read & Write credentials.
Keep the bucket private. Existing local media is not migrated by switching storage.

`NEXT_PUBLIC_APP_URL` is passed at build time as well as runtime. Rebuild
the web image after changing it.
Secrets are loaded at runtime from the ignored `deploy/.env`; they are excluded
from the image build context.

The web port binds to `127.0.0.1:3000` by default. Put an HTTPS reverse proxy
(such as Caddy or nginx) in front of it. Configure the proxy to accept uploads
up to 150 MiB and to disable buffering and permit long connections for SSE.
For a proxy on another host or in a container, configure `BIND_ADDRESS` and
firewall access appropriately. The face service has no published host port.

For Caddy installed on the host, a configuration for `dumpster.photo` is included
in `deploy/Caddyfile`. Copy it to `/etc/caddy/Caddyfile`, validate it with
`caddy validate --config /etc/caddy/Caddyfile`, and reload the Caddy service.
Allow TCP ports 80 and 443 through the host and provider firewalls. If Cloudflare
proxying prevents initial certificate validation, temporarily use DNS-only mode
for the domain while Caddy obtains a trusted certificate, then restore proxying.

Web and worker share a persistent `media` volume for the local storage fallback.
For object storage, configure the `S3_*` variables; both services use the same
bucket. Do not scale this deployment across hosts while using local storage.
The worker handles processing and expiry cleanup and should remain running.
Initial face image builds download the model and can take several minutes.
The web and worker images also include the sticker cutout model, about 214MB, downloaded during the image build. Cuts stay on the host.

Whisper downloads `Systran/faster-whisper-small` on first startup and persists it
in the `whisper-cache` volume. The worker waits for Whisper and face embedding
to become healthy. Whisper has no published host port; the worker connects to
`http://whisper:8000/v1`. No transcription API key is needed on this internal network.
The environment template uses one media lane to leave CPU and memory headroom
on a 4-vCPU, 8-GB host. Long videos can exceed the app's 180-second transcription
timeout; measure processing time before increasing concurrency or model size.

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml logs -f whisper
```

To verify transcription, upload a short video with speech to a room that allows
video, then check the worker logs and the resulting transcript. The worker also
samples frames from the clip and groups any faces it finds. The Whisper image
currently tracks `latest-cpu`; pin a tested image digest before repeatable releases.

To deploy updates, pull your code and run the same `up -d --build` command.
This recreates changed services and can briefly interrupt requests; it is a
single-host deployment. Restart policies recover exited containers, while health
checks report readiness (Docker does not restart a container just for being unhealthy).

```bash
# Stop the stack while retaining uploaded media.
docker compose --env-file deploy/.env -f deploy/compose.yml down
```

Avoid `down -v` unless you intend to delete the local media volume. Back up your
database and storage according to your retention policy.
