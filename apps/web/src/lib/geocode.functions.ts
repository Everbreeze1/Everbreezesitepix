import { rpcOp } from "./everlumen-api";

export const geocodeAddress = rpcOp<{ address: string }, { latitude: number; longitude: number }>(
  "geocodeAddress",
);
