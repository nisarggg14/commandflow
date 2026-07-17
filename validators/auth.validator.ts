import { z } from "zod";

export const registerSchema = z.object({
  companyName: z.string().min(2).max(100),

  name: z.string().min(2).max(50),

  email: z.string().email(),

  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z
    .string()
    .email("Invalid email address"),

  password: z
    .string()
    .min(8),
});