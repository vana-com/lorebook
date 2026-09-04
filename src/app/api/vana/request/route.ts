import {
  createRequestBindingRecord,
  setRequestBindingCookie,
} from "@/lib/vana/binding";
import {
  appForJourney,
  type LorebookJourney,
} from "@/lib/vana/constants";
import { mapClientError } from "@/lib/vana/errors";
import {
  createForegroundDelivery,
  registerForegroundDelivery,
} from "@/lib/vana/foreground-delivery";
import { jsonNoStore, noStore } from "@/lib/vana/response";
import {
  resolveFixtureJourney,
  resolveLaunchRuntime,
  resolveVanaDefaultEnv,
  resolveVanaDefaultNetwork,
  type VanaRuntime,
} from "@/lib/vana/runtime";
import { getVanaController, getVanaServerConfig } from "@/lib/vana/server";
import { NextRequest, NextResponse } from "next/server";

const DEFAULT_NETWORK = resolveVanaDefaultNetwork(process.env);
const DEFAULT_ENV = resolveVanaDefaultEnv(process.env);

export async function POST(request: NextRequest) {
  try {
    const runtime = resolveLaunchRuntime(
      new URL(request.url).searchParams,
      DEFAULT_NETWORK,
      DEFAULT_ENV,
    );
    const config = getVanaServerConfig();
    const journey = journeyFromUrl(request.url, runtime);
    const app = appForJourney(journey);
    const controller = getVanaController(runtime, app, config);
    const foregroundDelivery =
      journey === "deep"
        ? createForegroundDelivery(config.returnOrigin)
        : undefined;
    // ONE access request for every scope → the approval mints ONE grant that
    // covers them all, so no later approval overwrites an earlier scope set.
    const accessRequest = await controller.createAccessRequest({
      returnUrl: config.returnUrl,
      ...(foregroundDelivery ? { foregroundDelivery } : {}),
    });
    const binding = createRequestBindingRecord(
      {
        requestId: accessRequest.requestId,
        app,
        runtime,
        returnOrigin: config.returnOrigin,
        accessRequestExpiresAt: accessRequest.expiresAt,
      },
      config.appPrivateKey,
    );
    if (foregroundDelivery) {
      // Registered before the response so a store failure fails the request
      // loudly here. Handing the browser a DCR whose bearer was never stored
      // would strand the phone on a 403 it cannot explain; the abandoned DCR
      // expires and the user simply retries.
      await registerForegroundDelivery({
        binding: binding.payload,
        token: foregroundDelivery.token,
        builderAddress: controller.getAppAddress(),
      });
      console.info(
        `[vana/delivery] registered requestId=${accessRequest.requestId} continuation=${
          accessRequest.mobileContinuationUrl ? "minted" : "absent"
        }`,
      );
    }
    const response = noStore(NextResponse.json(accessRequest));
    setRequestBindingCookie(
      response.cookies,
      accessRequest.requestId,
      binding.value,
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

function journeyFromUrl(url: string, runtime: VanaRuntime): LorebookJourney {
  const params = new URL(url).searchParams;
  const values = params.getAll("mode");
  if (values.length !== 1 || (values[0] !== "quick" && values[0] !== "deep")) {
    throw new Error("Choose a valid Lorebook chapter.");
  }
  const fixture = resolveFixtureJourney(params, runtime);
  if (fixture && values[0] !== "deep") {
    throw new Error("Choose a valid Lorebook fixture.");
  }
  return fixture ?? values[0];
}
