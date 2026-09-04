# Enclave read review fixes — result

## Findings addressed

- **P1-1 — enclave reads did not acknowledge:** both status-poll and foreground-delivery reads now share a read lifecycle that calls `acknowledgeRead` after either an enclave or direct read succeeds. Acknowledgement remains best-effort, and a failed read is not acknowledged. The README now documents the completed DCR behavior.
- **P2-5 — route timeout and duplicate cold-read jobs:** `/api/vana/read` and `/api/vana/delivery` now export `maxDuration = 60`. Enclave `readRaw` requests use `wait: 25`, allowing the first Gateway request to long-poll before SDK polling begins.
- **P2-6 — scope mismatch was retryable:** enclave scope validation now throws `EnclaveReadError` with status 403, which maps to a terminal `failed` client response instead of Personal Server `unavailable`/503.

The other review findings target sibling repositories and were not changed here.

## Tests

- Added lifecycle coverage for successful acknowledgement, best-effort acknowledgement failure, and no acknowledgement after a failed read.
- Added coverage for the 25-second enclave long-poll setting.
- Added coverage that an enclave scope mismatch maps to terminal HTTP 403.

## Gates

- `pnpm typecheck` — passed
- `pnpm test` — passed (29/29)
- `pnpm build` — passed
