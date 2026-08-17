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

The app defaults to Moksha. The existing runtime query parameters remain available for controlled
tests:

- `?vana_env=dev` selects the dev Vana endpoints on Moksha.
- `?network=mainnet` selects mainnet with production endpoints.

## Environment

Register Lorebook in Vana Account, then configure:

```dotenv
VANA_PRIVATE_KEY=0x...
APP_URL=http://localhost:3010
```

The private key stays server-side. Browser request bindings are signed, HttpOnly, and valid for the
same one-hour window used by the data connection request so an app installation can finish without
silently losing the originating request.

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
