import type { AccessRequestStatusValue } from "@opendatalabs/vana-sdk/server";

export type ReturnState = {
  title: string;
  message: string;
  kind: "success" | "waiting" | "error";
};

export function returnStateForStatus(status: AccessRequestStatusValue): ReturnState {
  switch (status) {
    case "completed":
      return {
        title: "Your page is ready",
        message: "The approved read is complete. You can return to Lorebook.",
        kind: "success",
      };
    case "approved":
    case "ready_for_read":
      return {
        title: "Your data is ready",
        message: "The request is ready. Keep this tab open while the original tab finishes the approved read.",
        kind: "waiting",
      };
    case "pending":
      return {
        title: "Approval still pending",
        message: "The request has not reached a read-ready state yet.",
        kind: "waiting",
      };
    case "denied":
      return {
        title: "Request not completed",
        message: "No approved data was made available. Return to Lorebook and try again.",
        kind: "error",
      };
    case "expired":
      return {
        title: "Request expired",
        message: "This request expired. Return to Lorebook to start a new one.",
        kind: "error",
      };
  }
}
