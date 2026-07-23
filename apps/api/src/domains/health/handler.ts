export type HealthResponse = {
  ok: true;
  service: "sitepix-api";
  version: "v1";
};

export function healthHandler(): HealthResponse {
  return { ok: true, service: "sitepix-api", version: "v1" };
}

export { healthHandler as GET_V1_HEALTH };
