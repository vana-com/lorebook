import {
  BuilderUnknownError,
  GrantInvalidError,
  JobEnvelopeError,
  JobsClientError,
  JobNotFoundError,
  JobRejectedError,
  JobRequestTooLargeError,
  JobTimeoutError,
  JobTransportError,
  OwnerNotReadyError,
} from "@opendatalabs/vana-sdk";
import {
  AccessNotApprovedError,
  DirectConfigError,
  PaymentRequiredError,
  PersonalServerReadError,
} from "@opendatalabs/vana-sdk/server";
import { DeliveryStoreError } from "./delivery-store";
import { EnclaveReadError } from "./enclave";
import { LaunchRuntimeError } from "./runtime";

export type ClientErrorKind =
  | "invalid_request"
  | "unavailable"
  | "not_ready"
  | "payment_required"
  | "failed";

export type ClientError = {
  kind: ClientErrorKind;
  error: string;
  status: number;
};

export function mapClientError(error: unknown): ClientError {
  if (error instanceof LaunchRuntimeError) {
    return { kind: "invalid_request", error: error.message, status: 400 };
  }
  if (error instanceof PaymentRequiredError) {
    return {
      kind: "payment_required",
      error: "The app's escrow balance cannot cover this read. Fund the app identity and retry.",
      status: 402,
    };
  }
  if (error instanceof AccessNotApprovedError) {
    return {
      kind: "not_ready",
      error: "The approved data is not ready to read.",
      status: 409,
    };
  }
  if (error instanceof DeliveryStoreError) {
    return {
      kind: "unavailable",
      error: "The mobile delivery store is unavailable. Retry in a moment.",
      status: 503,
    };
  }
  if (error instanceof OwnerNotReadyError) {
    return {
      kind: "not_ready",
      error: "The Personal Server enclave is not ready yet. Retry in a moment.",
      status: 409,
    };
  }
  if (error instanceof GrantInvalidError) {
    return {
      kind: "failed",
      error: "The approved grant does not permit this enclave read.",
      status: 403,
    };
  }
  if (error instanceof BuilderUnknownError) {
    return {
      kind: "failed",
      error: "This app is not registered with the Enclave Gateway.",
      status: 403,
    };
  }
  if (error instanceof JobTimeoutError) {
    return {
      kind: "unavailable",
      error: "The enclave read timed out. Retry in a moment.",
      status: 504,
    };
  }
  if (error instanceof JobNotFoundError) {
    return {
      kind: "unavailable",
      error: "The enclave read job could not be found.",
      status: 502,
    };
  }
  if (error instanceof JobRequestTooLargeError) {
    return {
      kind: "failed",
      error: "The enclave read request is too large.",
      status: 413,
    };
  }
  if (error instanceof JobTransportError) {
    return {
      kind: "unavailable",
      error: "The Enclave Gateway is temporarily unavailable.",
      status: 503,
    };
  }
  if (error instanceof JobEnvelopeError || error instanceof JobRejectedError) {
    return {
      kind: "failed",
      error: "The Enclave Gateway returned an invalid read result.",
      status: 502,
    };
  }
  if (error instanceof JobsClientError) {
    return {
      kind: "failed",
      error: "The Enclave Gateway rejected the read job.",
      status: error.status ?? 502,
    };
  }
  if (error instanceof EnclaveReadError) {
    return { kind: "failed", error: error.message, status: error.status };
  }
  if (error instanceof PersonalServerReadError || hasNetworkError(error)) {
    return {
      kind: "unavailable",
      error: "The Personal Server is temporarily unavailable.",
      status: 503,
    };
  }
  if (error instanceof DirectConfigError) {
    return {
      kind: "failed",
      error: "The Vana app is not configured correctly.",
      status: 500,
    };
  }
  return { kind: "failed", error: "The Vana request failed.", status: 500 };
}

function hasNetworkError(error: unknown, depth = 0): boolean {
  if (!isRecord(error) || depth > 5) return false;
  if (typeof error.code === "string" && /^E[A-Z_]+$/.test(error.code)) return true;
  return hasNetworkError(error.cause, depth + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
