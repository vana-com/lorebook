# Lorebook

**Your data, told back to you.**

Lorebook is a small, real Vana app that turns user-approved data into a playful personal
portrait. It also serves as the reference end-to-end app for validating Vana handoff behavior
across desktop and mobile without embedding platform-specific routing in the app itself.

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

Lorebook contains no platform detector or Vana deep link. For deep requests only, its server adds
one fixed same-origin `/api/vana/delivery` URL and a one-time 32-byte bearer to DCR metadata.

### Hidden Desktop collection fixture

The dev/Moksha deployment exposes one explicit QA-only journey for proving a real missing-data
Desktop import of `spotify.savedTracks`:

`?vana_env=dev&network=moksha&fixture=spotify-saved-tracks`

All three selectors are required. The fixture is unavailable on production/mainnet, is not shown
in the normal chapter picker, and does not change either public journey's request contract. A
successful run renders a bounded saved-track summary only after the paid Personal Server read and
consumer acknowledgement. The first run requires an authenticated Spotify session in Vana Desktop.

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

On Vercel, set `APP_URL` to the canonical deployed HTTPS origin. The app identity derived from
`VANA_PRIVATE_KEY` must be registered and funded in every service-plane/network combination you
intend to use.

For phone E2E, override `APP_URL` in `.env.local` with the exact LAN-reachable dev-server URL,
such as `http://192.168.x.x:3010`; do not copy that placeholder literally.

## Local SDK E2E dependency

This local E2E checkout intentionally links `@opendatalabs/vana-sdk` to the adjacent
`../vana-sdk/packages/vana-sdk` package. It requires that checkout's `feat/mobile-direct-app-handoff`
branch with its `dist` built. Lorebook is not independently deployable with this file dependency;
switch back to a published SDK release before deployment.

The private key stays server-side. Browser request bindings are signed, HttpOnly, and valid for at
least the one-hour window used by the data connection request, so the originating tab keeps the
authorization it needs to poll status and read for the whole request lifetime.

Lorebook stores no browser pending request. The originating tab owns create and poll. For a
mobile-deep request, Lorebook registers a one-time bearer in a bounded process-local server cache;
the delivery callback reads and maps the foreground Personal Server result, acknowledges the DCR,
and retains only the product-safe snapshot for five minutes. Status/read serve that browser-bound
snapshot, so no Personal Server remains necessary after delivery. This proving cache requires one
long-lived Lorebook server process (or sticky routing); it is intentionally not suitable for a
multi-instance/serverless production deployment without shared ephemeral storage.

On mobile-deep requests the SDK returns one `mobileContinuationUrl` after the DCR
is created, and Lorebook renders a single explicit **Open Vana** link (`target="_blank"`,
`rel="noreferrer"`) that opens Vana in a separate context while this tab keeps polling. The link is
never launched automatically: asynchronous DCR creation cannot retain the original tap's iOS user
activation, so the user performs one deliberate tap. If the originating tab is reloaded or evicted
the flow does not resume — the user restarts and the abandoned DCR expires. This restart-on-tab-loss
behavior is an accepted first-release tradeoff.

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
