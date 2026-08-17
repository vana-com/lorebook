import { readRequestBinding } from "@/lib/vana/binding";
import { assertGrantReadReady } from "@/lib/vana/capability";
import { appForId } from "@/lib/vana/constants";
import { returnStateForStatus, type ReturnState } from "@/lib/vana/return-state";
import { getVanaController, getVanaServerConfig } from "@/lib/vana/server";
import { cookies } from "next/headers";
import Link from "next/link";

export default async function ConnectReturn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestId = typeof params.request_id === "string" ? params.request_id : null;
  const state = await authoritativeReturnState(requestId);

  return (
    <main className="return-shell">
      <p className={`mode-label ${state.kind}`}>Verified request status</p>
      <h1>{state.title}</h1>
      <p>{state.message}</p>
      <Link className="primary-action return-action" href="/">Return to Lorebook</Link>
    </main>
  );
}

async function authoritativeReturnState(requestId: string | null): Promise<ReturnState> {
  if (!requestId || requestId.length > 256) return invalidReturn();

  try {
    const config = getVanaServerConfig();
    const binding = readRequestBinding(
      await cookies(),
      { requestId, returnOrigin: config.returnOrigin },
      config.appPrivateKey,
    );
    if (!binding) return invalidReturn();

    const app = appForId(binding.appId);
    if (!app) return invalidReturn();
    const status = await getVanaController(binding.runtime, app, config).getAccessRequestStatus(
      requestId,
    );
    if (status.status === "approved" || status.status === "ready_for_read") {
      assertGrantReadReady(status);
    }
    return returnStateForStatus(status.status);
  } catch (error) {
    console.error(`[vana/return] Return verification failed for ${requestId}`, error);
    return {
      title: "Status unavailable",
      message: "The request status could not be verified. Return to Lorebook to try again.",
      kind: "error",
    };
  }
}

function invalidReturn(): ReturnState {
  return {
    title: "Request unavailable",
    message: "This return does not match a request from the current browser session.",
    kind: "error",
  };
}
