import { createRequestBinding, setRequestBindingCookie } from "@/lib/vana/binding";
import { appForMode, type LorebookMode } from "@/lib/vana/constants";
import { mapClientError } from "@/lib/vana/errors";
import { jsonNoStore, noStore } from "@/lib/vana/response";
import { resolveLaunchRuntime } from "@/lib/vana/runtime";
import { getVanaController, getVanaServerConfig } from "@/lib/vana/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const runtime = resolveLaunchRuntime(new URL(request.url).searchParams);
    const config = getVanaServerConfig();
    const app = appForMode(modeFromUrl(request.url));
    const controller = getVanaController(runtime, app, config);
    // ONE access request for every scope → the approval mints ONE grant that
    // covers them all, so no later approval overwrites an earlier scope set.
    const accessRequest = await controller.createAccessRequest({ returnUrl: config.returnUrl });
    const binding = createRequestBinding(
      {
        requestId: accessRequest.requestId,
        app,
        runtime,
        returnOrigin: config.returnOrigin,
        accessRequestExpiresAt: accessRequest.expiresAt,
      },
      config.appPrivateKey,
    );
    const response = noStore(NextResponse.json(accessRequest));
    setRequestBindingCookie(
      response.cookies,
      accessRequest.requestId,
      binding,
      process.env.NODE_ENV === "production",
    );
    return response;
  } catch (error) {
    const clientError = mapClientError(error);
    console.error("[vana/request] Request creation failed", error);
    return jsonNoStore(
      { kind: clientError.kind, error: clientError.error },
      { status: clientError.status },
    );
  }
}

function modeFromUrl(url: string): LorebookMode {
  const values = new URL(url).searchParams.getAll("mode");
  if (values.length !== 1 || (values[0] !== "quick" && values[0] !== "deep")) {
    throw new Error("Choose a valid Lorebook chapter.");
  }
  return values[0];
}
