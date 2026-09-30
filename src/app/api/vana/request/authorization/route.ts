import { privateKeyToAccount } from "viem/accounts";
import { NextRequest } from "next/server";
import { directReadMessage } from "@/lib/vana/embed";
import { mapClientError } from "@/lib/vana/errors";
import { getBoundVanaRequest, requestIdFromUrl } from "@/lib/vana/request";
import { jsonNoStore } from "@/lib/vana/response";

/**
 * POST /api/vana/request/authorization?requestId=<dcr id>
 * A fresh, short-lived read signature for a request this browser created, so
 * Vana's embedded sheet can load the request's real scopes. Anything not bound
 * to this browser (the request-binding cookie) is refused.
 */
export async function POST(request: NextRequest) {
  const requestId = requestIdFromUrl(request.url);
  if (!requestId) {
    return jsonNoStore(
      { kind: "invalid_request", error: "A single requestId is required." },
      { status: 400 },
    );
  }
  try {
    const bound = getBoundVanaRequest(request, requestId);
    if (!bound) {
      return jsonNoStore(
        { kind: "unavailable", error: "This request is not available in this browser session." },
        { status: 403 },
      );
    }
    const key = bound.config.appPrivateKey;
    const account = privateKeyToAccount(
      (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`,
    );
    const timestamp = String(Date.now());
    const signature = await account.signMessage({
      message: directReadMessage(requestId, timestamp),
    });
    return jsonNoStore({ appAddress: account.address, signature, timestamp });
  } catch (error) {
    const clientError = mapClientError(error);
    console.error(`[vana/authorization] Signing failed for ${requestId}`, error);
    return jsonNoStore(
      { kind: clientError.kind, error: clientError.error },
      { status: clientError.status },
    );
  }
}
