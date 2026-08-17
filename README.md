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
5. Lorebook reads from the user's Personal Server and acknowledges the read.

Lorebook does not contain a Vana deep link, delivery endpoint, connector, or platform detector.

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
# For phone E2E, use the exact LAN-reachable dev-server URL, for example:
APP_URL=http://192.168.1.42:3010
```

On Vercel, set `APP_URL` to the canonical deployed HTTPS origin. The app identity derived from
`VANA_PRIVATE_KEY` must be registered and funded in every service-plane/network combination you
intend to use.

The private key stays server-side. Browser request bindings are signed, HttpOnly, and valid for the
same one-hour window used by the data connection request so an app installation can finish without
silently losing the originating request. The browser also retains only a versioned, non-secret
pending request and selected chapter in local storage until that request completes, is reset, or expires;
this lets the same request resume after a Vana app switch without creating another request.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
```

For a full handoff proof, test each journey from both a desktop browser and a mobile browser. A
successful deep test is not complete until Lorebook resumes, reads the approved data, and Vana
records the consumer acknowledgment.

## License

MIT
