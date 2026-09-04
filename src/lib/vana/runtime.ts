import {
  DESKTOP_SAVED_TRACKS_FIXTURE,
  type LorebookJourney,
} from "./constants";

export type VanaRuntime = {
  env: "dev" | "production";
  network: "moksha" | "mainnet";
};

export function chainIdForNetwork(network: VanaRuntime["network"]): 1480 | 14800 {
  return network === "mainnet" ? 1480 : 14800;
}

/** The two runtime pairings Lorebook is exercised against, as testers see them. */
export type RuntimeOptionId = "testnet" | "mainnet";

export const RUNTIME_OPTIONS: readonly {
  id: RuntimeOptionId;
  label: string;
  runtime: VanaRuntime;
}[] = [
  { id: "testnet", label: "Testnet", runtime: { env: "dev", network: "moksha" } },
  { id: "mainnet", label: "Mainnet", runtime: { env: "production", network: "mainnet" } },
];

/** The option a resolved runtime maps to, or null for an off-menu pairing. */
export function runtimeOptionId(runtime: VanaRuntime): RuntimeOptionId | null {
  const match = RUNTIME_OPTIONS.find(
    (option) => option.runtime.env === runtime.env && option.runtime.network === runtime.network,
  );
  return match ? match.id : null;
}

export class LaunchRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchRuntimeError";
  }
}

export function resolveLaunchRuntime(params: URLSearchParams): VanaRuntime {
  const vanaEnvs = params.getAll("vana_env");
  const networks = params.getAll("network");

  if (vanaEnvs.length > 1 || networks.length > 1) {
    throw new LaunchRuntimeError("Launch runtime parameters may only be provided once.");
  }

  const vanaEnv = normalizeVanaEnv(vanaEnvs[0] ?? null);
  const network = normalizeNetwork(networks[0] ?? null);

  if (vanaEnvs.length === 1 && vanaEnv === null) {
    throw new LaunchRuntimeError("Invalid vana_env. Expected dev or production.");
  }

  if (networks.length === 1 && network === null) {
    throw new LaunchRuntimeError("Invalid network. Expected moksha or mainnet.");
  }

  return {
    env: vanaEnv ?? "production",
    network: network ?? "mainnet",
  };
}

/** Resolve a hidden fixture only when every explicit dev guard is present. */
export function resolveFixtureJourney(
  params: URLSearchParams,
  runtime = resolveLaunchRuntime(params),
): Extract<LorebookJourney, "desktop-saved-tracks"> | null {
  const fixtures = params.getAll("fixture");
  if (fixtures.length === 0) return null;
  if (
    fixtures.length !== 1 ||
    fixtures[0] !== DESKTOP_SAVED_TRACKS_FIXTURE ||
    runtime.env !== "dev" ||
    runtime.network !== "moksha"
  ) {
    throw new LaunchRuntimeError("Invalid Lorebook fixture.");
  }
  return "desktop-saved-tracks";
}

function normalizeVanaEnv(value: string | null): VanaRuntime["env"] | null {
  if (value === null) return null;
  const normalized = value.toLowerCase();
  if (normalized === "dev" || normalized === "development") return "dev";
  if (normalized === "production" || normalized === "prod") return "production";
  return null;
}

function normalizeNetwork(value: string | null): VanaRuntime["network"] | null {
  if (value === null) return null;
  const normalized = value.toLowerCase();
  return normalized === "moksha" || normalized === "mainnet" ? normalized : null;
}
