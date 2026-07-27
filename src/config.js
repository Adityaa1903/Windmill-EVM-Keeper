const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "n", "off"]);
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

/**
 * @param {string[]} argv
 */
function parseCliArgs(argv) {
  const flags = new Set();
  const values = new Map();

  for (const token of argv) {
    if (!token.startsWith("--")) {
      continue;
    }

    const content = token.slice(2);
    const separatorIndex = content.indexOf("=");
    if (separatorIndex === -1) {
      flags.add(content.toLowerCase());
      continue;
    }

    const key = content.slice(0, separatorIndex).toLowerCase();
    const value = content.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  return { flags, values };
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {{ min: number; variable: string }} options
 * @returns {number}
 */
export function parseInteger(value, fallback, { min, variable }) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${variable} must be an integer. Received: ${value}`);
  }

  if (parsed < min) {
    throw new Error(
      `${variable} must be greater than or equal to ${min}. Received: ${value}`
    );
  }

  return parsed;
}

/**
 * @param {string | undefined | null} value
 * @returns {bigint | null}
 */
function parseChainId(value) {
  if (!value) {
    return null;
  }

  try {
    return BigInt(value.trim());
  } catch {
    throw new Error(`EXPECTED_CHAIN_ID must be a valid integer: ${value}`);
  }
}

export function loadConfig({
  env = process.env,
  argv = process.argv.slice(2)
} = {}) {
  const { flags, values } = parseCliArgs(argv);

  const strategyName = (
    values.get("strategy") ??
    env.KEEPER_STRATEGY ??
    "noop"
  )
    .trim()
    .toLowerCase();

  if (!strategyName) {
    throw new Error("KEEPER_STRATEGY cannot be empty.");
  }

  const intervalMs = parseInteger(
    values.get("interval-ms") ?? env.KEEPER_INTERVAL_MS,
    15000,
    { min: 1000, variable: "KEEPER_INTERVAL_MS" }
  );

  const maxActionsPerCycle = parseInteger(env.MAX_ACTIONS_PER_CYCLE, 25, {
    min: 1,
    variable: "MAX_ACTIONS_PER_CYCLE"
  });

  const txConfirmations = parseInteger(env.TX_CONFIRMATIONS, 1, {
    min: 0,
    variable: "TX_CONFIRMATIONS"
  });

  const telemetryPort = parseInteger(env.TELEMETRY_PORT, 0, {
    min: 0,
    variable: "TELEMETRY_PORT"
  });

  const logLevel = (env.LOG_LEVEL ?? "info").trim().toLowerCase();
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error(
      `LOG_LEVEL must be one of: ${Array.from(LOG_LEVELS).join(", ")}`
    );
  }

  return {
    once: flags.has("once"),
    dryRun: flags.has("dry-run") ? true : parseBoolean(env.DRY_RUN, false),
    strategyName,
    rpcUrl: (env.RPC_URL ?? "http://127.0.0.1:8545").trim(),
    expectedChainId: parseChainId(env.EXPECTED_CHAIN_ID),
    privateKey: (env.PRIVATE_KEY ?? "").trim(),
    contractAddress: (env.CONTRACT_ADDRESS ?? "").trim(),
    intervalMs,
    maxActionsPerCycle,
    txConfirmations,
    logLevel,
    telemetryPort,
    telemetryId: (env.TELEMETRY_ID ?? "").trim(),
    telemetryOnly: parseBoolean(env.TELEMETRY_ONLY, false)
  };
}
