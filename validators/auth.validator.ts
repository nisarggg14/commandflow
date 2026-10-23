import { z } from "zod";

export const registerSchema = z
  .object({
    companyName: z.string().max(100).optional().or(z.literal("")),
    name: z.string().min(2).max(50),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Please confirm your password"),
    invitationCode: z.string().trim().max(128).optional().or(z.literal("")),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine(
    (data) => Boolean(data.invitationCode) || (data.companyName?.trim().length ?? 0) >= 2,
    {
      message: "Enter a company name or an invitation code.",
      path: ["companyName"],
  });

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});