import { rpcOp } from "./sitepix-api";

export const geocodeAddress = rpcOp<{ address: string }, { latitude: number; longitude: number }>(
  "geocodeAddress",
);
