import { createServer } from "node:http";

/**
 * Exposes a small, read-only health document for dashboards and monitoring.
 * The endpoint is disabled unless TELEMETRY_PORT is configured.
 *
 * @param {{ port: number; getStatus: () => unknown; logger: any }} params
 */
export function startTelemetryServer({ port, getStatus, logger }) {
  if (!port) return null;

  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store"
    });
    response.end(JSON.stringify(getStatus()));
  });

  server.listen(port, () => logger.info("Keeper telemetry server started", { port }));
  return server;
}
