import { rpcOp } from "./sitepix-api";

export const synthesizeBreezeSpeech = rpcOp<{ text: string; voiceName?: string }, unknown>(
  "synthesizeBreezeSpeech",
  { idempotent: true },
);
