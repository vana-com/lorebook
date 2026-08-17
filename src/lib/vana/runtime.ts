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

  const vanaEnv = vanaEnvs[0] ?? null;
  const network = networks[0] ?? null;

  if (vanaEnv !== null && vanaEnv !== "dev") {
    throw new LaunchRuntimeError("Invalid vana_env. Expected dev or no value.");
  }

  if (network !== null && network !== "moksha" && network !== "mainnet") {
    throw new LaunchRuntimeError("Invalid network. Expected moksha, mainnet, or no value.");
  }

  if (vanaEnv === "dev" && network === "mainnet") {
    throw new LaunchRuntimeError("The dev environment only supports the moksha network.");
  }

  return {
    env: vanaEnv === "dev" ? "dev" : "production",
    // Default to the Moksha testnet; mainnet must be requested explicitly
    // with ?network=mainnet.
    network: vanaEnv === "dev" ? "moksha" : (network ?? "moksha"),
  };
}
