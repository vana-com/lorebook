import { readEnclaveScopes } from "../src/lib/vana/enclave";
import { chainIdForNetwork, type VanaRuntime } from "../src/lib/vana/runtime";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

async function main(): Promise<void> {
  const network = (process.env.VANA_NETWORK?.trim() || "moksha") as VanaRuntime["network"];
  if (network !== "mainnet" && network !== "moksha") {
    throw new Error("VANA_NETWORK must be mainnet or moksha.");
  }
  const scope = requiredEnv("SCOPE");
  const results = await readEnclaveScopes({
    gatewayUrl: requiredEnv("VANA_GATEWAY_URL"),
    chainId: chainIdForNetwork(network),
    builderPrivateKey: requiredEnv("VANA_PRIVATE_KEY"),
    grantId: requiredEnv("GRANT_ID"),
    scopes: [scope],
  });
  console.log(JSON.stringify(results[scope], null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
