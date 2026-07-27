import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * @param {any} error
 * @returns {string}
 */
function formatError(error) {
  return (
    error?.shortMessage ??
    error?.reason ??
    error?.message ??
    String(error) ??
    "unknown"
  );
}

/**
 * @param {any} result
 * @returns {any}
 */
function resolveTransaction(result) {
  if (!result) {
    return null;
  }

  if (typeof result === "object" && "tx" in result) {
    return result.tx;
  }

  return result;
}

/**
 * @param {any} strategy
 * @param {any} item
 * @param {number} index
 * @returns {string}
 */
function describeItem(strategy, item, index) {
  if (typeof strategy.describeWorkItem === "function") {
    return strategy.describeWorkItem(item);
  }

  if (item?.id !== undefined) {
    return `id=${item.id}`;
  }

  return `item-${index + 1}`;
}

export class KeeperRunner {
  /**
   * @param {{
   *   config: any;
   *   provider: any;
   *   signer: any;
   *   contract: any;
   *   strategy: any;
   *   logger: any;
   * }} params
   */
  constructor({ config, provider, signer, contract, strategy, logger }) {
    this.config = config;
    this.provider = provider;
    this.signer = signer;
    this.contract = contract;
    this.strategy = strategy;
    this.logger = logger;

    this.stopped = false;
    this.signalHandlersInstalled = false;
    this.consecutiveFailures = 0;
    this.startedAt = null;
    this.chainId = null;
    this.lastCycle = null;
    this.lastError = null;
  }

  async start() {
    this.startedAt = new Date().toISOString();
    await this.logStartup();

    if (this.config.once) {
      await this.runCycle();
      return;
    }

    this.installSignalHandlers();

    while (!this.stopped) {
      const cycleStart = Date.now();
      try {
        await this.runCycle();
        this.consecutiveFailures = 0;
      } catch (error) {
        this.consecutiveFailures += 1;
        this.lastError = formatError(error);
        this.logger.error("Keeper cycle failed", {
          consecutiveFailures: this.consecutiveFailures,
          error: formatError(error)
        });
      }

      const elapsedMs = Date.now() - cycleStart;
      const waitMs = Math.max(0, this.config.intervalMs - elapsedMs);
      if (!this.stopped && waitMs > 0) {
        await sleep(waitMs);
      }
    }
  }

  async logStartup() {
    this.logger.info("Keeper starting", {
      strategy: this.strategy.name,
      rpcUrl: this.config.rpcUrl,
      dryRun: this.config.dryRun,
      intervalMs: this.config.intervalMs,
      maxActionsPerCycle: this.config.maxActionsPerCycle
    });

    const network = await this.provider.getNetwork();
    const chainId = BigInt(network.chainId);
    this.chainId = chainId.toString();
    this.logger.info("Connected network", { chainId: chainId.toString() });

    if (
      this.config.expectedChainId !== null &&
      this.config.expectedChainId !== chainId
    ) {
      throw new Error(
        `Chain ID mismatch. Expected ${this.config.expectedChainId.toString()}, got ${chainId.toString()}`
      );
    }

    if (this.signer) {
      this.logger.info("Signer configured", { address: this.signer.address });
    }

    if (this.contract) {
      this.logger.info("Contract configured", { address: this.contract.target });
    }
  }

  async runCycle() {
    const cycleStartedAt = Date.now();
    const now = Math.floor(Date.now() / 1000);

    const workItems = await this.strategy.getWorkItems({
      now,
      provider: this.provider,
      signer: this.signer,
      contract: this.contract,
      logger: this.logger,
      config: this.config
    });

    if (!Array.isArray(workItems)) {
      throw new Error("Strategy getWorkItems() must return an array.");
    }

    if (workItems.length === 0) {
      this.logger.info("No actionable items found");
      this.recordCycle({ discovered: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, cycleStartedAt });
      return;
    }

    const selectedItems = workItems.slice(0, this.config.maxActionsPerCycle);
    if (selectedItems.length < workItems.length) {
      this.logger.warn("Cycle capped by MAX_ACTIONS_PER_CYCLE", {
        discovered: workItems.length,
        selected: selectedItems.length
      });
    }

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (let index = 0; index < selectedItems.length; index += 1) {
      const item = selectedItems[index];
      const itemLabel = describeItem(this.strategy, item, index);

      if (this.config.dryRun) {
        skipped += 1;
        this.logger.info("Dry run - would execute work item", { item: itemLabel });
        continue;
      }

      try {
        const result = await this.strategy.executeWorkItem({
          item,
          provider: this.provider,
          signer: this.signer,
          contract: this.contract,
          logger: this.logger,
          config: this.config
        });

        const tx = resolveTransaction(result);
        if (tx && typeof tx.wait === "function") {
          const receipt = await tx.wait(this.config.txConfirmations);
          this.logger.info("Work item executed", {
            item: itemLabel,
            txHash: tx.hash ?? receipt?.hash ?? "unknown",
            status: receipt?.status ?? null
          });
        } else {
          this.logger.info("Work item executed", {
            item: itemLabel,
            txHash: tx?.hash ?? result?.hash ?? null
          });
        }

        succeeded += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn("Work item execution failed", {
          item: itemLabel,
          error: formatError(error)
        });
      }
    }

    this.logger.info("Cycle complete", {
      discovered: workItems.length,
      processed: selectedItems.length,
      succeeded,
      failed,
      skipped,
      elapsedMs: Date.now() - cycleStartedAt
    });
    this.recordCycle({ discovered: workItems.length, processed: selectedItems.length, succeeded, failed, skipped, cycleStartedAt });
  }

  recordCycle({ discovered, processed, succeeded, failed, skipped, cycleStartedAt }) {
    this.lastCycle = {
      discovered,
      processed,
      succeeded,
      failed,
      skipped,
      elapsedMs: Date.now() - cycleStartedAt,
      completedAt: new Date().toISOString()
    };
    this.lastError = null;
  }

  getStatus() {
    return {
      id: this.config.telemetryId || this.signer?.address || "keeper",
      address: this.signer?.address ?? null,
      chainId: this.chainId,
      startedAt: this.startedAt,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      lastCycle: this.lastCycle
    };
  }

  stop(reason = "manual") {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.logger.warn("Stopping keeper", { reason });
  }

  installSignalHandlers() {
    if (this.signalHandlersInstalled) {
      return;
    }

    this.signalHandlersInstalled = true;
    process.on("SIGINT", () => this.stop("SIGINT"));
    process.on("SIGTERM", () => this.stop("SIGTERM"));
  }
}
