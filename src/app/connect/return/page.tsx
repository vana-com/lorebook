import { readRequestBinding } from "@/lib/vana/binding";
import { assertGrantReadReady } from "@/lib/vana/capability";
import { appForId } from "@/lib/vana/constants";
import { returnStateForStatus, type ReturnState } from "@/lib/vana/return-state";
import { buildHomePath } from "@/lib/vana/request-path";
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
  const view = await authoritativeReturnState(requestId);

  return (
    <main className="return-shell">
      <p className={`mode-label ${view.state.kind}`}>Verified request status</p>
      <h1>{view.state.title}</h1>
      <p>{view.state.message}</p>
      <Link className="primary-action return-action" href={view.homeHref}>Return to Lorebook</Link>
    </main>
  );
}

type ReturnView = { state: ReturnState; homeHref: string };

async function authoritativeReturnState(requestId: string | null): Promise<ReturnView> {
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
    return {
      state: returnStateForStatus(status.status),
      homeHref: buildHomePath(binding.runtime),
    };
  } catch (error) {
    console.error(`[vana/return] Return verification failed for ${requestId}`, error);
    return {
      state: {
        title: "Status unavailable",
        message: "The request status could not be verified. Return to Lorebook to try again.",
        kind: "error",
      },
      homeHref: "/",
    };
  }
}

function invalidReturn(): ReturnView {
  return {
    state: {
      title: "Request unavailable",
      message: "This return does not match a request from the current browser session.",
      kind: "error",
    },
    homeHref: "/",
  };
}
