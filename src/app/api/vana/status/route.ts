import { mapClientError } from "@/lib/vana/errors";
import { assertGrantReadReady } from "@/lib/vana/capability";
import { getBoundVanaRequest, requestIdFromUrl } from "@/lib/vana/request";
import { jsonNoStore } from "@/lib/vana/response";
import { NextRequest } from "next/server";

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

    const status = await bound.controller.getAccessRequestStatus(requestId);
    if (status.status === "approved" || status.status === "ready_for_read") {
      assertGrantReadReady(status);
    }
    return jsonNoStore({ status: status.status });
  } catch (error) {
    const clientError = mapClientError(error);
    console.error(`[vana/status] Status failed for ${requestId}`, error);
    return jsonNoStore(
      { kind: clientError.kind, error: clientError.error },
      { status: clientError.status },
    );
  }
}
