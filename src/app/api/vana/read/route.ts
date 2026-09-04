import { mapClientError } from "@/lib/vana/errors";
import { getBoundVanaRequest, requestIdFromUrl } from "@/lib/vana/request";
import { jsonNoStore } from "@/lib/vana/response";
import { getDeliveredResult } from "@/lib/vana/foreground-delivery";
import { readApprovedScopes } from "@/lib/vana/server";
import { NextRequest } from "next/server";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
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

    const delivered = await getDeliveredResult(bound.binding);
    if (delivered) {
      return jsonNoStore(delivered);
    }

    // Read the one approved chapter and return its product-safe Lorebook model.
    const result = await readApprovedScopes(
      bound.controller,
      bound.binding.runtime,
      bound.app,
      bound.config,
      requestId,
    );
    return jsonNoStore({ scope: result.scope, data: result.data });
  } catch (error) {
    const clientError = mapClientError(error);
    console.error(`[vana/read] Read failed for ${requestId}`, error);
    return jsonNoStore(
      {
        kind: clientError.kind,
        error: clientError.error,
        ...(clientError.detail ? { detail: clientError.detail } : {}),
      },
      { status: clientError.status },
    );
  }
}
