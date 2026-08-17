export type VanaRuntime = {
  env: "dev" | "production";
  network: "moksha" | "mainnet";
};

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
