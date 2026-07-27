import "dotenv/config";
import { ethers } from "ethers";
import { loadConfig } from "./config.js";
import { KeeperRunner } from "./keeper-runner.js";
import { createLogger } from "./logger.js";
import { createStrategy } from "./strategies/index.js";
import { startTelemetryServer } from "./telemetry-server.js";

/**
 * @param {{
 *   strategy: { requiresContract: boolean; name: string; abi: ethers.Interface | ethers.InterfaceAbi };
 *   config: ReturnType<typeof loadConfig>;
 *   provider: ethers.Provider;
 *   signer: ethers.Signer | null;
 * }} params
 */
function buildContract({ strategy, config, provider, signer }) {
  if (!strategy.requiresContract) {
    return null;
  }

  if (!config.contractAddress) {
    throw new Error(
      `Strategy "${strategy.name}" requires CONTRACT_ADDRESS to be set.`
    );
  }

  if (!ethers.isAddress(config.contractAddress)) {
    throw new Error(`Invalid CONTRACT_ADDRESS: ${config.contractAddress}`);
  }

  const contractRunner = signer ?? provider;
  return new ethers.Contract(config.contractAddress, strategy.abi, contractRunner);
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const strategy = createStrategy(config.strategyName);

  if (strategy.requiresSigner && !config.privateKey) {
    throw new Error(
      `Strategy "${strategy.name}" requires PRIVATE_KEY to be set.`
    );
  }

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const signer = config.privateKey
    ? new ethers.Wallet(config.privateKey, provider)
    : null;
  const contract = buildContract({ strategy, config, provider, signer });

  const runner = new KeeperRunner({
    config,
    provider,
    signer,
    contract,
    strategy,
    logger
  });

  startTelemetryServer({
    port: config.telemetryPort,
    getStatus: () => runner.getStatus(),
    logger
  });

  await runner.start();
}

main().catch((error) => {
  const message =
    error?.shortMessage ?? error?.reason ?? error?.message ?? "unknown";
  console.error(`[keeper] fatal -> ${message}`);
  process.exit(1);
});
