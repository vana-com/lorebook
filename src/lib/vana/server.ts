import "server-only";

import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, createEscrowGatewayClient } from "@opendatalabs/vana-sdk";
import {
  createDefaultAccessRequestClient,
  createDirectDataController,
  PersonalServerReadError,
  readPersonalServerData,
  type EscrowPaymentConfig,
} from "@opendatalabs/vana-sdk/server";
import {
  mapLorebookSnapshot,
  type LorebookSnapshot,
} from "@/lib/combined-snapshot";
import { resolveAppUrl } from "./app-url";
import type { RequestBinding } from "./binding";
import { assertGrantReadReady } from "./capability";
import { LOREBOOK_QUICK_APP, type VanaAppDefinition } from "./constants";
import { resolveVanaEndpoints, type VanaEndpoints } from "./endpoints";
import {
  approvedEnclaveScopes,
  readResumableEnclaveScopes,
  shouldUseEnclaveRead,
} from "./enclave";
import { readThenAcknowledge } from "./read-lifecycle";
import { chainIdForNetwork, type VanaRuntime } from "./runtime";

type Controller = ReturnType<typeof createDirectDataController>;

/**
 * The direct read's destination comes from a response, so it is checked before
 * Lorebook signs a request to it. A bare https origin, like `gatewayOrigin`:
 * the SDK appends `/v1/data/<scope>` by concatenation, so a query or fragment
 * would send the request somewhere the signature does not name
 * (`https://host/#x` + `/v1/data/…` requests `/`). The relay mints one origin
 * per Personal Server (`https://<id>.relay.vana.com`), so the host itself
 * cannot be pinned here.
 */
function directServerUrl(value: string | undefined): string {
  let url: URL | null = null;
  try {
    url = new URL(value ?? "");
  } catch {
    url = null;
  }
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new PersonalServerReadError("The Personal Server URL is not a bare https origin.", 502);
  }
  return url.origin;
}

const controllers = new Map<string, Controller>();

export type VanaServerConfig = {
  appPrivateKey: string;
  appUrl: string;
  returnOrigin: string;
  returnUrl: string;
};

export function getVanaServerConfig(): VanaServerConfig {
  const appPrivateKey = process.env.VANA_PRIVATE_KEY?.trim();
  const rawAppUrl = process.env.APP_URL?.trim();

  if (!appPrivateKey) throw new Error("Missing VANA_PRIVATE_KEY.");
  if (!rawAppUrl) throw new Error("Missing APP_URL.");

  const resolvedUrl = resolveAppUrl(rawAppUrl);
  return {
    appPrivateKey,
    ...resolvedUrl,
  };
}

export function getVanaController(
  runtime: VanaRuntime,
  app: VanaAppDefinition = LOREBOOK_QUICK_APP,
  config = getVanaServerConfig(),
): Controller {
  const endpoints = resolveVanaEndpoints(runtime);
  const key = `${app.id}:${runtime.env}:${runtime.network}:${endpoints.accessRequestBaseUrl}:${endpoints.approvalAppBaseUrl}`;
  const cached = controllers.get(key);
  if (cached) return cached;

  // The SDK resolves its service plane from `env` alone, so one deployment
  // could not serve both networks. Pass the network's own endpoints instead.
  const controller = createDirectDataController({
    env: runtime.env,
    network: runtime.network,
    appPrivateKey: config.appPrivateKey,
    app: {
      id: app.id,
      name: app.name,
      homepageUrl: config.appUrl,
    },
    source: app.source,
    // Request every scope at once so the approval mints ONE grant covering all
    // of them (avoids the BUI-732 scope-overwrite from separate DCRs).
    scopes: [...app.scopes],
    endpoints,
  });
  controllers.set(key, controller);
  return controller;
}

/** Read Lorebook's one requested data type, then acknowledge the completed read. */
export async function readApprovedScopes(
  controller: Controller,
  runtime: VanaRuntime,
  app: VanaAppDefinition,
  config: VanaServerConfig,
  binding: RequestBinding,
): Promise<
  | { state: "running"; jobId: string }
  | { scope: string; data: LorebookSnapshot }
> {
  const status = await controller.getAccessRequestStatus(binding.requestId);
  const enclaveMode = shouldUseEnclaveRead(status);
  assertGrantReadReady(status, { requirePersonalServerUrl: !enclaveMode });
  // Readiness guarantees the fields required by the selected transport.
  const grantId = status.grantId as string;

  const chainId = chainIdForNetwork(runtime.network);
  if (app.scopes.length !== 1 || !app.scopes[0]) {
    throw new PersonalServerReadError("Lorebook requires exactly one approved data type.", 400);
  }
  const scope = app.scopes[0];
  const account = privateKeyToAccount(config.appPrivateKey as `0x${string}`);
  const endpoints = resolveVanaEndpoints(runtime);
  const signMessage = (message: string) => account.signMessage({ message });
  const acknowledge = () => acknowledgeRead(binding.requestId, account, endpoints);
  const onAcknowledgeError = (error: unknown) =>
    console.warn(
      `[vana/read] acknowledgeRead failed for ${binding.requestId}`,
      error,
    );

  if (enclaveMode) {
    const outcome = await readResumableEnclaveScopes({
      requestId: binding.requestId,
      gatewayUrl: endpoints.gatewayUrl,
      chainId,
      builderPrivateKey: config.appPrivateKey,
      grantId,
      scopes: approvedEnclaveScopes(status, app.scopes),
      status,
    });
    if (outcome.state === "running") return outcome;
    return readThenAcknowledge({
      read: async () => ({
        scope: status.scope ?? scope,
        data: mapLorebookSnapshot(app, scope, outcome.data[scope]),
      }),
      acknowledge,
      onAcknowledgeError,
    });
  }

  return readThenAcknowledge({
    read: async () => {
      const escrow: EscrowPaymentConfig = {
        client: createEscrowGatewayClient(endpoints.escrowGatewayUrl),
        escrowContract: CONTRACTS.DataPortabilityEscrow.addresses[chainId],
        chainId,
        signTypedData: account.signTypedData,
      };
      const result = await readPersonalServerData({
        personalServerUrl: directServerUrl(status.personalServerUrl),
        scope,
        grantId,
        payerAddress: account.address,
        signMessage,
        escrow,
      });
      return {
        scope: status.scope ?? scope,
        data: mapLorebookSnapshot(app, scope, result.data),
      };
    },
    acknowledge,
    onAcknowledgeError,
  });
}

/** Read using foreground routing supplied by Vana Mobile, then acknowledge. */
export async function readForegroundDeliveredScopes(
  runtime: VanaRuntime,
  app: VanaAppDefinition,
  config: VanaServerConfig,
  input: {
    requestId: string;
    personalServerUrl: string;
    grantId: string;
    scopes: string[];
  },
): Promise<{ scope: string; data: LorebookSnapshot }> {
  if (
    app.scopes.length !== 1 ||
    input.scopes.length !== 1 ||
    input.scopes[0] !== app.scopes[0]
  ) {
    throw new PersonalServerReadError("Lorebook requires its exact approved data type.", 400);
  }
  const scope = input.scopes[0];
  const chainId = chainIdForNetwork(runtime.network);
  const account = privateKeyToAccount(config.appPrivateKey as `0x${string}`);
  const endpoints = resolveVanaEndpoints(runtime);
  return readThenAcknowledge({
    read: async () => {
      // The phone supplies and validates its own route, so a legacy owner's
      // callback reads it directly instead of being forced into a job.
      if (shouldUseEnclaveRead({ personalServerUrl: input.personalServerUrl })) {
        const outcome = await readResumableEnclaveScopes({
          requestId: input.requestId,
          gatewayUrl: endpoints.gatewayUrl,
          chainId,
          builderPrivateKey: config.appPrivateKey,
          grantId: input.grantId,
          scopes: input.scopes,
        });
        if (outcome.state === "running") {
          throw new PersonalServerReadError(
            "Foreground delivery cannot leave an enclave read running.",
            502,
          );
        }
        return { scope, data: mapLorebookSnapshot(app, scope, outcome.data[scope]) };
      }
      const escrow: EscrowPaymentConfig = {
        client: createEscrowGatewayClient(endpoints.escrowGatewayUrl),
        escrowContract: CONTRACTS.DataPortabilityEscrow.addresses[chainId],
        chainId,
        signTypedData: account.signTypedData,
      };
      const result = await readPersonalServerData({
        personalServerUrl: directServerUrl(input.personalServerUrl),
        scope,
        grantId: input.grantId,
        payerAddress: account.address,
        signMessage: (message: string) => account.signMessage({ message }),
        escrow,
      });
      return { scope, data: mapLorebookSnapshot(app, scope, result.data) };
    },
    acknowledge: () => acknowledgeRead(input.requestId, account, endpoints),
    onAcknowledgeError: (error) =>
      console.warn(
        `[vana/delivery] acknowledgeRead failed for ${input.requestId}`,
        error,
      ),
  });
}

async function acknowledgeRead(
  requestId: string,
  account: ReturnType<typeof privateKeyToAccount>,
  endpoints: VanaEndpoints,
): Promise<void> {
  const accessRequestClient = createDefaultAccessRequestClient({
    baseUrl: endpoints.accessRequestBaseUrl,
    approvalBaseUrl: endpoints.approvalAppBaseUrl,
    appAddress: account.address,
    signMessage: (message: string) => account.signMessage({ message }),
  });
  await accessRequestClient.acknowledgeRead?.(requestId);
}
