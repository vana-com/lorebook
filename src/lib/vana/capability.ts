import {
  AccessNotApprovedError,
  type AccessRequestStatus,
} from "@opendatalabs/vana-sdk/server";

/**
 * A DCR requesting multiple scopes mints ONE grant covering all of them, so
 * readiness is a grant-level check, not a single-scope match. Direct reads
 * require the Personal Server URL; enclave jobs only require the approved
 * grant because the Gateway routes the work. The status endpoint only reports
 * `scope` = the first scope, but `grantId` covers every requested scope.
 */
export function assertGrantReadReady(
  status: AccessRequestStatus,
  options: { requirePersonalServerUrl?: boolean } = {},
): void {
  if (
    (status.status !== "approved" && status.status !== "ready_for_read") ||
    !status.grantId ||
    (options.requirePersonalServerUrl !== false && !status.personalServerUrl)
  ) {
    throw new AccessNotApprovedError("The approved grant is not ready to read.");
  }
}
