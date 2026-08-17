import {
  AccessNotApprovedError,
  type AccessRequestStatus,
} from "@opendatalabs/vana-sdk/server";

/**
 * A DCR requesting multiple scopes mints ONE grant covering all of them, so
 * readiness is a grant-level check (approved + grantId + Personal Server URL),
 * not a single-scope match. The status endpoint only reports `scope` = the
 * first scope, but `grantId` covers every requested scope.
 */
export function assertGrantReadReady(status: AccessRequestStatus): void {
  if (
    (status.status !== "approved" && status.status !== "ready_for_read") ||
    !status.grantId ||
    !status.personalServerUrl
  ) {
    throw new AccessNotApprovedError("The approved grant is not ready to read.");
  }
}
