import { z } from "zod";
export const chatRequestSchema = z.object({
  conversationId: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(10_000),
  connectedClientId: z.string().trim().min(1).max(128).nullable().optional(),
  mfaChallengeToken: z.string().trim().min(1).max(256).optional(),
}).strict();