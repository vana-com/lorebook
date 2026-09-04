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
import type { RequestBinding } from "./binding";
import { assertGrantReadReady } from "./capability";
import { LOREBOOK_QUICK_APP, type VanaAppDefinition } from "./constants";
import {
  applyDirectEndpointOverrides,
  directEndpointOverrides,
} from "./endpoints";
import {
  approvedEnclaveScopes,
  isEnclaveReadMode,
  readResumableEnclaveScopes,
  shouldUseEnclaveRead,
} from "./enclave";
import { readThenAcknowledge } from "./read-lifecycle";
import { chainIdForNetwork, type VanaRuntime } from "./runtime";

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
  const endpoints = directEndpointOverrides();
  const key = `${app.id}:${runtime.env}:${runtime.network}:${endpoints?.accessRequestBaseUrl ?? ""}:${endpoints?.approvalAppBaseUrl ?? ""}`;
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
    ...(endpoints ? { endpoints } : {}),
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
  const endpoints = applyDirectEndpointOverrides(getDirectEndpoints(runtime.env));
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
      gatewayUrl: process.env.VANA_GATEWAY_URL ?? "",
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
        personalServerUrl: status.personalServerUrl as string,
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
  const endpoints = applyDirectEndpointOverrides(getDirectEndpoints(runtime.env));
  return readThenAcknowledge({
    read: async () => {
      if (isEnclaveReadMode()) {
        const outcome = await readResumableEnclaveScopes({
          requestId: input.requestId,
          gatewayUrl: process.env.VANA_GATEWAY_URL ?? "",
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
        personalServerUrl: input.personalServerUrl,
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
  endpoints: ReturnType<typeof getDirectEndpoints>,
): Promise<void> {
  const accessRequestClient = createDefaultAccessRequestClient({
    baseUrl: endpoints.accessRequestBaseUrl,
    approvalBaseUrl: endpoints.approvalAppBaseUrl,
    appAddress: account.address,
    signMessage: (message: string) => account.signMessage({ message }),
  });
  await accessRequestClient.acknowledgeRead?.(requestId);
}
