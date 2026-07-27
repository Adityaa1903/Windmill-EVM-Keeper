import { createServer } from "node:http";

/**
 * Exposes a small, read-only health document for dashboards and monitoring.
 * The endpoint is disabled unless TELEMETRY_PORT is configured.
 *
 * @param {{ port: number; getStatus: () => unknown; logger: any }} params
 */
export function startTelemetryServer({ port, getStatus, logger }) {
  if (!port) return null;

  const matches = [];

  function sendJson(response, status, body) {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }

  function getStats() {
    const uniqueOrders = new Set(matches.flatMap((match) => [match.buyOrderId, match.sellOrderId]));
    return {
      updatedAt: new Date().toISOString(),
      network: "local",
      currentBlock: 0,
      paused: false,
      protocolFeeBps: "0",
      totalOrders: uniqueOrders.size,
      activeOrders: 0,
      activeOrdersArePartial: false,
      matchedOrders: matches.length,
      totalNotional: matches.reduce((total, match) => total + BigInt(match.executedQuantity), BigInt(0)).toString(),
      recentMatches: matches.slice(-10).reverse()
    };
  }

  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && path === "/health") {
      sendJson(response, 200, { ...getStatus(), submittedMatches: matches.length });
      return;
    }

    if (request.method === "GET" && path === "/stats") {
      sendJson(response, 200, getStats());
      return;
    }

    if (request.method === "POST" && path === "/matches") {
      try {
        let payload = "";
        for await (const chunk of request) payload += chunk;
        const input = JSON.parse(payload);
        for (const field of ["buyOrderId", "sellOrderId", "executedQuantity", "settlementPrice"]) {
          if (input[field] === undefined || input[field] === null || input[field] === "") throw new Error(`${field} is required.`);
        }
        const match = {
          buyOrderId: String(input.buyOrderId),
          sellOrderId: String(input.sellOrderId),
          executedQuantity: String(input.executedQuantity),
          settlementPrice: String(input.settlementPrice),
          keeper: String(input.keeper ?? getStatus().address ?? getStatus().id ?? "local-keeper"),
          blockNumber: 0,
          transactionHash: `local-${Date.now()}`
        };
        BigInt(match.executedQuantity);
        BigInt(match.settlementPrice);
        matches.push(match);
        sendJson(response, 201, match);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid match payload." });
      }
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });

  server.listen(port, "127.0.0.1", () => logger.info("Keeper telemetry server started", { port }));
  return server;
}
