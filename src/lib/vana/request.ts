import type { NextRequest } from "next/server";
import { readRequestBinding } from "./binding";
import { appForId } from "./constants";
import { getVanaController, getVanaServerConfig } from "./server";

export function requestIdFromUrl(url: string): string | null {
  const values = new URL(url).searchParams.getAll("requestId");
  if (values.length !== 1) return null;
  const requestId = values[0]?.trim();
  return requestId && requestId.length <= 256 ? requestId : null;
}

export function getBoundVanaRequest(request: NextRequest, requestId: string) {
  const config = getVanaServerConfig();
  const binding = readRequestBinding(
    request.cookies,
    { requestId, returnOrigin: config.returnOrigin },
    config.appPrivateKey,
  );
  if (!binding) return null;
  const app = appForId(binding.appId);
  if (!app) return null;
  return { binding, app, controller: getVanaController(binding.runtime, app, config), config };
}
