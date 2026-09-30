"use client";

// "Connect with Vana" in an in-page sheet instead of a redirect.
//
//   tap ──▶ VanaConnect.open()  (Vana-hosted launcher + iframe on Vana Account)
//   sheet signs the person in, then asks for the request:
//     createRequest()                     existing POST /api/vana/request
//     POST /api/vana/request/authorization short-lived read signature
//   person allows in the sheet, opens Vana to finish;
//   this tab polls status and reads exactly like the redirect flow.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  VANA_EMBED_CLIENT_ID,
  VANA_EMBED_SCRIPT_PATH,
} from "@/lib/vana/embed";

type RequestStatus = "pending" | "approved" | "completed" | "denied" | "expired";

interface RequestAuthorization {
  appAddress: `0x${string}`;
  signature: `0x${string}`;
  timestamp: string;
}

interface SheetHandle {
  close(): void;
  setRequestStatus(status: RequestStatus): void;
}

interface SheetEvent {
  code?: string;
  type: "close" | "connected" | "error" | "ready" | "signed-in";
}

interface VanaConnectGlobal {
  open(options: {
    appName: string;
    clientId: string;
    getRequest: () => Promise<{ authorization: RequestAuthorization; id: string }>;
    onEvent?: (event: SheetEvent) => void;
    vanaOrigin: string;
  }): SheetHandle;
}

declare global {
  interface Window {
    VanaConnect?: VanaConnectGlobal;
  }
}

type SheetFlow = "idle" | "open" | "waiting" | "reading" | "error";

const POLL_MS = 3_000;

let launcher: Promise<VanaConnectGlobal> | null = null;

/** Loads Vana's hosted launcher once per page. */
function loadLauncher(accountOrigin: string): Promise<VanaConnectGlobal> {
  launcher ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${accountOrigin}${VANA_EMBED_SCRIPT_PATH}`;
    script.async = true;
    script.onload = () =>
      window.VanaConnect ? resolve(window.VanaConnect) : reject(new Error("launcher missing"));
    script.onerror = () => {
      launcher = null;
      reject(new Error("launcher failed to load"));
    };
    document.head.append(script);
  });
  return launcher;
}

export function VanaSheetConnect<T>({
  accountOrigin,
  createRequest,
  onResult,
  readResult,
}: {
  accountOrigin: string;
  createRequest: () => Promise<{ requestId: string }>;
  onResult: (result: T) => void;
  readResult: (requestId: string) => Promise<T>;
}) {
  const [flow, setFlow] = useState<SheetFlow>("idle");
  const requestId = useRef<string | null>(null);
  const handle = useRef<SheetHandle | null>(null);
  const poll = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (poll.current !== null) window.clearInterval(poll.current);
    poll.current = null;
  }, []);

  useEffect(() => {
    // Warm the launcher so the tap opens the sheet without a network wait.
    loadLauncher(accountOrigin).catch(() => undefined);
    return () => {
      stopPolling();
      handle.current?.close();
    };
  }, [accountOrigin, stopPolling]);

  const checkStatus = useCallback(async () => {
    const id = requestId.current;
    if (!id) return;
    const response = await fetch(`/api/vana/status?requestId=${encodeURIComponent(id)}`);
    if (!response.ok) return;
    const { status } = (await response.json()) as { status?: string };
    if (status === "approved" || status === "ready_for_read") {
      stopPolling();
      handle.current?.setRequestStatus("completed");
      setFlow("reading");
      try {
        onResult(await readResult(id));
        setFlow("idle");
        requestId.current = null;
      } catch {
        setFlow("error");
      }
      return;
    }
    if (status === "denied" || status === "expired") {
      stopPolling();
      handle.current?.setRequestStatus(status);
      requestId.current = null;
      setFlow("error");
    }
  }, [onResult, readResult, stopPolling]);

  async function open() {
    let vana: VanaConnectGlobal;
    try {
      vana = await loadLauncher(accountOrigin);
    } catch {
      setFlow("error");
      return;
    }
    setFlow("open");
    handle.current = vana.open({
      appName: "Lorebook",
      clientId: VANA_EMBED_CLIENT_ID,
      async getRequest() {
        if (!requestId.current) {
          requestId.current = (await createRequest()).requestId;
          poll.current ??= window.setInterval(() => void checkStatus(), POLL_MS);
        }
        const response = await fetch(
          `/api/vana/request/authorization?requestId=${encodeURIComponent(requestId.current)}`,
          { method: "POST" },
        );
        if (!response.ok) throw new Error("authorization failed");
        return {
          authorization: (await response.json()) as RequestAuthorization,
          id: requestId.current,
        };
      },
      onEvent(event) {
        if (event.type === "connected") setFlow("waiting");
        if (event.type === "error" && event.code === "request_failed") setFlow("error");
        if (event.type === "close") {
          handle.current = null;
          // Closing the sheet does not cancel an approval in progress.
          setFlow((current) => (current === "open" && !requestId.current ? "idle" : current));
        }
      },
      vanaOrigin: accountOrigin,
    });
  }

  if (flow === "waiting" || flow === "reading") {
    return (
      <button className="secondary-button loading" type="button" disabled>
        <span className="spinner" />
        {flow === "reading" ? "Writing your page…" : "Finish in Vana, then come back"}
      </button>
    );
  }
  return (
    <button className="secondary-button" type="button" onClick={() => void open()}>
      {flow === "error" ? "Try Connect with Vana again" : "Connect with Vana"}
    </button>
  );
}
