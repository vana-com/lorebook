import "server-only";

import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, createEscrowGatewayClient } from "@opendatalabs/vana-sdk";
import {
  createDefaultAccessRequestClient,
  createDirectDataController,
  getDirectEndpoints,
  PersonalServerReadError,
  readPersonalServerData,
  type EscrowPaymentConfig,
} from "@opendatalabs/vana-sdk/server";
import {
  mapLorebookSnapshot,
  type LorebookSnapshot,
} from "@/lib/combined-snapshot";
import { resolveAppUrl } from "./app-url";
import { assertGrantReadReady } from "./capability";
import { LOREBOOK_QUICK_APP, type VanaAppDefinition } from "./constants";
import type { VanaRuntime } from "./runtime";

type Controller = ReturnType<typeof createDirectDataController>;

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
  const key = `${app.id}:${runtime.env}:${runtime.network}`;
  const cached = controllers.get(key);
  if (cached) return cached;

  // SDK keeps production app/API endpoints for production+moksha while deriving
  // Moksha's escrow chain defaults from `network`. Do not hardcode a gateway
  // here: that would turn an SDK-owned endpoint decision into app drift.
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
  requestId: string,
): Promise<{ scope: string; data: LorebookSnapshot }> {
  const status = await controller.getAccessRequestStatus(requestId);
  assertGrantReadReady(status);
  // assertGrantReadReady guarantees both are present.
  const personalServerUrl = status.personalServerUrl as string;
  const grantId = status.grantId as string;

  const account = privateKeyToAccount(config.appPrivateKey as `0x${string}`);
  const chainId = chainIdForNetwork(runtime.network);
  const endpoints = getDirectEndpoints(runtime.env);
  const escrow: EscrowPaymentConfig = {
    client: createEscrowGatewayClient(endpoints.escrowGatewayUrl),
    escrowContract: CONTRACTS.DataPortabilityEscrow.addresses[chainId],
    chainId,
    signTypedData: account.signTypedData,
  };
  const signMessage = (message: string) => account.signMessage({ message });

  if (app.scopes.length !== 1 || !app.scopes[0]) {
    throw new PersonalServerReadError("Lorebook requires exactly one approved data type.", 400);
  }
  const scope = app.scopes[0];
  const result = await readPersonalServerData({
    personalServerUrl,
    scope,
    grantId,
    payerAddress: account.address,
    signMessage,
    escrow,
  });
  const snapshot = mapLorebookSnapshot(app, scope, result.data);

  // Acknowledge once so Vana Web completes the DCR and closes the approval tab.
  // Best-effort: an ack failure must not fail an otherwise-successful read.
  try {
    const accessRequestClient = createDefaultAccessRequestClient({
      baseUrl: endpoints.accessRequestBaseUrl,
      approvalBaseUrl: endpoints.approvalAppBaseUrl,
      appAddress: account.address,
      signMessage,
    });
    await accessRequestClient.acknowledgeRead?.(requestId);
  } catch (error) {
    console.warn(`[vana/read] acknowledgeRead failed for ${requestId}`, error);
  }

  return { scope: status.scope ?? scope, data: snapshot };
}

// Protocol chain id per network: Vana mainnet 1480, Moksha testnet 14800 —
// the keys present in CONTRACTS.*.addresses.
function chainIdForNetwork(network: VanaRuntime["network"]): 1480 | 14800 {
  return network === "mainnet" ? 1480 : 14800;
}
