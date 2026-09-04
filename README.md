# Lorebook

**Your data, told back to you.**

Lorebook is a small, real Vana app that turns user-approved data into a playful personal
portrait. It is also the reference end-to-end app for the Vana mobile handoff: it exercises the
full path from a browser tab, through approval in the Vana mobile app, to an approved read
delivered back to the originating tab — without embedding any platform-specific routing in the
app itself.

## Two journeys

| Journey | Data requested | Expected handoff |
| --- | --- | --- |
| Quick read | `spotify.profile` | Vana Web can complete this light request |
| Deep cut | `chatgpt.conversations` | Vana sends the user to the installed desktop or mobile app when deeper collection is required |

Both journeys use the same browser-facing Vana SDK flow:

1. Lorebook creates a signed data connection request.
2. It opens the HTTPS approval URL returned by Vana.
3. Vana decides where the request can be completed.
4. Lorebook polls the same request until the approved data is ready.
5. Desktop/light reads use the normal browser path. Mobile-deep reads are delivered to Lorebook's
   authenticated foreground callback while Vana Mobile still exposes the Personal Server.

Lorebook contains no platform detector and no Vana deep link. For deep requests only, its server
adds one fixed same-origin `/api/vana/delivery` URL and a one-time 32-byte bearer to DCR metadata.

## The mobile end-to-end flow

This is the sequence the repo exists to demonstrate. Nothing in it is mobile-aware except the
single link Lorebook renders when the SDK hands it one.

1. **Create.** `POST /api/vana/request` calls `createAccessRequest`, and for a deep journey passes
   `foregroundDelivery: { url, token }` — a fixed same-origin callback plus a one-time bearer.
   Vana mints a `mobileContinuationUrl` only when the request is deep *and* carries that
   descriptor, because a phone cannot finish a handoff it has no way to deliver back.
2. **Register.** The bearer's hash is written to the delivery store (see below) alongside the
   signed request binding, before the response is returned to the browser.
3. **Open.** The SDK returns `state.type === "ready_to_open"` with a plain HTTPS
   `https://open[-dev].vana.org/continue#<ticket>` URL. Lorebook renders it as one explicit
   **Open Vana** link and never launches it automatically: DCR creation is asynchronous, so the
   original tap can no longer be trusted to retain iOS user activation. Verified links (iOS
   Universal Links / Android App Links) deliver it to Vana Mobile; the same URL loads a web
   install/recovery fallback when the app is absent.
4. **Approve.** The user approves in Vana Mobile. The originating tab keeps polling throughout.
5. **Deliver.** While Vana Mobile is still foregrounded and exposing the Personal Server, it POSTs
   `{ requestId, personalServerUrl, grantId, builderAddress, scopes }` to `/api/vana/delivery` with
   the bearer. Lorebook validates and consumes the capability once, performs the paid Personal
   Server read server-side, acknowledges the DCR, and retains only the product-safe snapshot for
   five minutes.
6. **Finish.** `GET /api/vana/status` and `GET /api/vana/read` serve that browser-bound snapshot, so
   no Personal Server is needed after delivery and the originating tab completes normally.

If the originating tab is reloaded or evicted the flow does not resume — the user restarts and the
abandoned DCR expires. This restart-on-tab-loss behavior is an accepted first-release tradeoff; the
SDK owns no persistence, so do not build caller-side resume storage against it.

## Delivery store

Steps 2 and 5 above happen in two unrelated HTTP requests: the browser registers the capability,
and the phone redeems it minutes later. On one long-lived server process an in-memory map is
enough. **On a serverless host those requests routinely land on different instances**, and a
process-local map means the callback rejects a bearer it never saw — the phone reports
"Couldn't import your data" for a request that was approved correctly.

`src/lib/vana/delivery-store.ts` puts that behind a small `DeliveryStore` interface with two
implementations:

- **memory** — the zero-config default, so this repo runs with nothing but `VANA_PRIVATE_KEY` and
  `APP_URL`. Correct only when one process serves every request.
- **redis** — selected automatically when a Redis REST URL and token are present. Both halves of the
  handoff then share one store, and delivery stays one-time via `DEL` returning `1` to exactly one
  caller.

Configure either `LOREBOOK_REDIS_REST_URL`/`LOREBOOK_REDIS_REST_TOKEN`, or the
`KV_REST_API_*`/`UPSTASH_REDIS_REST_*` pairs that Vercel's Redis integrations inject — in which case
a deployed Lorebook needs no extra configuration. A URL set without its token (or the reverse)
throws at startup rather than silently falling back to memory, because a half-configured serverless
deployment is exactly the failure this store exists to prevent.

Every deployment logs which store it resolved, once, on first use:

```
[vana/delivery] store=redis (shared across instances)
[vana/delivery] store=memory (single process only; mobile delivery will reject callbacks that land on another instance)
```

## Diagnosing a failed handoff

The phone always receives the same opaque `403 {"delivered":false}`, so a caller cannot probe which
check it failed. The server names the cause:

```
[vana/delivery] registered requestId=dcr_... continuation=minted
[vana/delivery] rejected   requestId=dcr_... reason=token_mismatch
[vana/delivery] delivered  requestId=dcr_... scope=chatgpt.conversations
```

`reason` is one of `unknown_request`, `malformed_token`, `token_mismatch`, `builder_mismatch`,
`scope_mismatch`, `already_consumed`, or `unknown_app`. `unknown_request` on a request that was
minted successfully is the cross-instance symptom above — check `store=` in the logs first.

### Hidden Desktop collection fixture

The dev/Moksha deployment exposes one explicit QA-only journey for proving a real missing-data
Desktop import of `spotify.savedTracks`:

`?vana_env=dev&network=moksha&fixture=spotify-saved-tracks`

All three selectors are required. The fixture is unavailable on production/mainnet, is not shown
in the normal chapter picker, and does not change either public journey's request contract. A
successful run renders a bounded saved-track summary only after the paid Personal Server read and
consumer acknowledgement. The first run requires an authenticated Spotify session in Vana Desktop.
It is Desktop-only by construction: Lorebook builds a foreground-delivery descriptor only for the
`deep` journey, so this fixture is never minted a `mobileContinuationUrl`.

## Run locally

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3010](http://localhost:3010).

The app defaults to the production service plane and Vana mainnet. The runtime selectors match
the other deployed Vana apps and stay independent:

- `vana_env=dev` selects `app-dev.vana.org` and the dev service plane.
- `network=moksha` selects Moksha testnet.
- Use both for the standard dev deployment flow:
  `?vana_env=dev&network=moksha`.

The same Vercel deployment can therefore serve production/mainnet with no query parameters and
dev/Moksha with the combined query parameters. Lorebook forwards only these selectors to its
server request boundary; status and read calls remain bound to the signed request runtime.

## Environment

Register Lorebook in Vana Account, then configure:

```dotenv
VANA_PRIVATE_KEY=0x...
APP_URL=http://localhost:3010
```

On Vercel, set `APP_URL` to the canonical deployed HTTPS origin, and make sure only one host serves
it. `APP_URL` is what the foreground-delivery callback URL is derived from, so a stale alias
pointing at an older deployment sends the phone's callback somewhere the capability was never
registered.

The app identity derived from `VANA_PRIVATE_KEY` must be registered and funded in every
service-plane/network combination you intend to use.

For phone E2E, override `APP_URL` in `.env.local` with the exact LAN-reachable dev-server URL,
such as `http://192.168.x.x:3010`; do not copy that placeholder literally.

Optional, for a shared delivery store — see [Delivery store](#delivery-store):

```dotenv
LOREBOOK_REDIS_REST_URL=https://...
LOREBOOK_REDIS_REST_TOKEN=...
```

The private key stays server-side. Browser request bindings are signed, HttpOnly, and valid for at
least the one-hour window used by the data connection request, so the originating tab keeps the
authorization it needs to poll status and read for the whole request lifetime.

Lorebook stores no browser pending request. The originating tab owns create and poll.

## Enclave read mode (preview)

The preview jobs path is opt-in. With `VANA_READ_MODE=enclave`, Lorebook keeps the existing Direct
DCR creation and status polling, then submits each approved scope to the Node-only SDK jobs client.
The server resolves the grant owner from the status when available or from the Gateway's public
grant endpoint, decrypts the jobs result, and feeds the decoded JSON through the existing Lorebook
rendering. Enclave mode does not use escrow; after a successful read it sends the same consumer
acknowledgement as the direct path so Vana Web can complete the request. With the flag unset, the
production direct-read behavior is unchanged.

Configure the preview locally without committing real endpoints or keys:

```dotenv
VANA_READ_MODE=enclave
VANA_DEFAULT_NETWORK=moksha
VANA_GATEWAY_URL=https://gateway-preview.example
VANA_ACCESS_REQUEST_BASE_URL=http://approval-preview.example
VANA_APPROVAL_APP_BASE_URL=http://approval-preview.example
```

`VANA_DEFAULT_NETWORK` is the server-side fallback when the request URL has no `network` parameter.
It accepts `mainnet` or `moksha` and defaults to `mainnet`; an explicit query parameter still wins.
Startup fails with a clear configuration error when the default is `mainnet` but the Gateway host
contains `moksha`. `VANA_GATEWAY_URL` must be a bare HTTPS origin (or loopback HTTP origin). To
inspect an already-approved scope without the UI, use the CLI; it defaults to Moksha
(`VANA_NETWORK=moksha`) and prints only the decrypted result:

```bash
GRANT_ID=0x... \
SCOPE=spotify.profile \
VANA_GATEWAY_URL=https://gateway-preview.example \
VANA_PRIVATE_KEY=0x... \
VANA_NETWORK=moksha \
pnpm enclave:read
```

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
```

For a full handoff proof, test each journey from both a desktop browser and a mobile browser over
HTTPS only — the mobile-deep continuation is an `https://open[-dev].vana.org/continue#<ticket>` URL
delivered by iOS Universal Links / Android App Links, so a plain `http://` origin cannot exercise
it. A successful deep test is not complete until the originating tab reads the approved data and
Vana records the consumer acknowledgment. On mobile a reloaded or evicted originating tab restarts
rather than resumes.

## License

MIT
