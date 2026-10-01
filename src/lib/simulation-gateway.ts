import "server-only";

export type GatewayRole = "APP" | "WORKER";

function required(name: "SIMULATION_GATEWAY_URL" | "LAB_SERVER_TOKEN") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export async function simulationGateway<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(required("SIMULATION_GATEWAY_URL"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-poceada-token": required("LAB_SERVER_TOKEN"),
    },
    body: JSON.stringify({ action, payload }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(body.error || `Simulation gateway returned HTTP ${response.status}`);
  }
  return body.data as T;
}
