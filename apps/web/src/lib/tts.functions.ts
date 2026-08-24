import { rpcOp } from "./everlumen-api";

export const synthesizeBreezeSpeech = rpcOp<{ text: string; voiceName?: string }, unknown>(
  "synthesizeBreezeSpeech",
  { idempotent: true },
);
