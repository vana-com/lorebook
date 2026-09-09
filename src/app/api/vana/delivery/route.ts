import { appForId } from "@/lib/vana/constants";
import {
  consumeForegroundDelivery,
  storeDeliveredResult,
} from "@/lib/vana/foreground-delivery";
import { jsonNoStore } from "@/lib/vana/response";
import {
  getVanaServerConfig,
  readForegroundDeliveredScopes,
} from "@/lib/vana/server";
import { NextRequest } from "next/server";

export const maxDuration = 60;

type DeliveryBody = {
  requestId: string;
  personalServerUrl: string;
  grantId: string;
  builderAddress: string;
  scopes: string[];
};

export async function POST(request: NextRequest) {
  const token = bearerToken(request.headers.get("authorization"));
  const body = await parseBody(request);
  if (!token || !body) {
    return jsonNoStore({ delivered: false }, { status: 400 });
  }

  const config = getVanaServerConfig();
  const consumed = await consumeForegroundDelivery({
    requestId: body.requestId,
    token,
    scopes: body.scopes,
    builderAddress: body.builderAddress,
  });
  // The phone always sees the same opaque refusal; the reason is logged, never
  // returned, so a caller cannot probe which check it failed.
  if (!consumed.ok) {
    console.warn(
      `[vana/delivery] rejected requestId=${body.requestId} reason=${consumed.reason}`,
    );
    return jsonNoStore({ delivered: false }, { status: 403 });
  }
  const binding = consumed.binding;
  const app = appForId(binding.appId);
  if (!app) {
    console.warn(
      `[vana/delivery] rejected requestId=${body.requestId} reason=unknown_app app=${binding.appId}`,
    );
    return jsonNoStore({ delivered: false }, { status: 403 });
  }

  try {
    const result = await readForegroundDeliveredScopes(
      binding.runtime,
      app,
      config,
      body,
    );
    await storeDeliveredResult({ binding, ...result });
    console.info(
      `[vana/delivery] delivered requestId=${body.requestId} scope=${result.scope}`,
    );
    return jsonNoStore({ delivered: true });
  } catch (error) {
    console.error(`[vana/delivery] Delivery failed for ${body.requestId}`, error);
    return jsonNoStore({ delivered: false }, { status: 502 });
  }
}

function bearerToken(value: string | null): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  return match?.[1] ?? null;
}

async function parseBody(request: NextRequest): Promise<DeliveryBody | null> {
  try {
    const value: unknown = await request.json();
    if (!isRecord(value)) return null;
    if (
      typeof value.requestId !== "string" ||
      value.requestId.length === 0 ||
      value.requestId.length > 256 ||
      typeof value.personalServerUrl !== "string" ||
      !isHttpsUrl(value.personalServerUrl) ||
      typeof value.grantId !== "string" ||
      value.grantId.length === 0 ||
      value.grantId.length > 512 ||
      typeof value.builderAddress !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(value.builderAddress) ||
      !Array.isArray(value.scopes) ||
      value.scopes.length === 0 ||
      !value.scopes.every((scope) => typeof scope === "string" && scope.length <= 256)
    ) {
      return null;
    }
    return value as DeliveryBody;
  } catch {
    return null;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
