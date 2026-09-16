import { chainIdForNetwork, type VanaRuntime } from "./runtime";

export type DirectEndpointOverrides = {
  accessRequestBaseUrl?: string;
  approvalAppBaseUrl?: string;
};

export type VanaEndpoints = {
  chainId: number;
  accessRequestBaseUrl: string;
  approvalAppBaseUrl: string;
  escrowGatewayUrl: string;
  /** DP RPC origin the enclave jobs client submits to (same host as escrow). */
  gatewayUrl: string;
};

/**
 * The canonical public service plane of each network. One deployment serves
 * both, so these follow the request's `network` rather than the deployment's
 * environment: `?network=moksha&vana_env=dev` on the mainnet build must reach
 * Moksha's Gateway and app, not mainnet's.
 */
const NETWORK_SERVICES = {
  mainnet: { appBaseUrl: "https://app.vana.org", gatewayUrl: "https://dp-rpc.vana.org" },
  moksha: {
    appBaseUrl: "https://app-dev.vana.org",
    gatewayUrl: "https://dp-rpc.moksha.vana.org",
  },
} as const;

export function directEndpointOverrides(
  env: Record<string, string | undefined> = process.env,
): DirectEndpointOverrides | undefined {
  const accessRequestBaseUrl = env.VANA_ACCESS_REQUEST_BASE_URL?.trim();
  const approvalAppBaseUrl = env.VANA_APPROVAL_APP_BASE_URL?.trim();
  if (!accessRequestBaseUrl && !approvalAppBaseUrl) return undefined;
  return {
    ...(accessRequestBaseUrl ? { accessRequestBaseUrl } : {}),
    ...(approvalAppBaseUrl ? { approvalAppBaseUrl } : {}),
  };
}

/** Service URLs for one request's runtime; env vars override, for previews. */
export function resolveVanaEndpoints(
  runtime: VanaRuntime,
  env: Record<string, string | undefined> = process.env,
): VanaEndpoints {
  const canonical = NETWORK_SERVICES[runtime.network];
  const overrides = directEndpointOverrides(env);
  const gatewayUrl = env.VANA_GATEWAY_URL?.trim() || canonical.gatewayUrl;

  return {
    chainId: chainIdForNetwork(runtime.network),
    accessRequestBaseUrl: overrides?.accessRequestBaseUrl ?? canonical.appBaseUrl,
    approvalAppBaseUrl: overrides?.approvalAppBaseUrl ?? canonical.appBaseUrl,
    escrowGatewayUrl: gatewayUrl,
    gatewayUrl,
  };
}
