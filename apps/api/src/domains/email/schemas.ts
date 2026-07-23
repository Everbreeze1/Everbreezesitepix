import { z } from "zod";

export const fieldReportBodySchema = z.object({
  subject: z.string().trim().min(1).max(200),
  pdfBase64: z.string().min(1).max(15_000_000),
  pdfName: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[\w.\- ]+$/, "Invalid file name"),
});

export type FieldReportBody = z.infer<typeof fieldReportBodySchema>;
