export type DirectEndpointOverrides = {
  accessRequestBaseUrl?: string;
  approvalAppBaseUrl?: string;
};

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

export function applyDirectEndpointOverrides<
  T extends { accessRequestBaseUrl: string; approvalAppBaseUrl: string },
>(
  defaults: T,
  env: Record<string, string | undefined> = process.env,
): T {
  return { ...defaults, ...directEndpointOverrides(env) };
}
