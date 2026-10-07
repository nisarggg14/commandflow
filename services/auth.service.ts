import { prisma } from "@/lib/prisma";
import { hashPassword, comparePassword } from "@/lib/bcrypt";
import { generateToken, hashSessionToken, verifyToken } from "@/lib/jwt";
import { registerSchema, loginSchema } from "@/validators/auth.validator";
import { UserRole } from "@prisma/client";
import { UnauthorizedError } from "@/lib/errors";

export function resolvePublicRegistrationRole(): UserRole {
  return UserRole.ADMIN;
}

function sanitizeUser(user: { [key: string]: unknown }) {
  const { password, mfaSecret, ...rest } = user;
  return rest;
}

export async function registerUser(data: unknown) {
  const validatedData = registerSchema.parse(data);



  if (process.env.NODE_ENV === "production" && (validatedData.password.length < 12 || ["admin123", "password", "password123", "commandflow"].includes(validatedData.password.toLowerCase()))) throw new Error("A strong production password is required.");

  const existingUser = await prisma.user.findUnique({
    where: {
      email: validatedData.email,
    },
  });

  if (existingUser) {
    throw new Error("An account with this email already exists.");
  }

  const slug = validatedData.companyName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");

  const hashedPassword = await hashPassword(validatedData.password);

  const { company, user } = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: validatedData.companyName,
        slug,
      },
    });

    const user = await tx.user.create({
      data: {
        name: validatedData.name,
        email: validatedData.email,
        password: hashedPassword,
        role: resolvePublicRegistrationRole(),
        companyId: company.id,
      },
    });

    return { company, user };
  });

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  });

  await prisma.session.create({ data: { token: hashSessionToken(token), userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
  return {
    success: true,
    message: "Company and admin user created successfully",
    token,
    user: sanitizeUser(user),
    company,
  };
}

export async function loginUser(data: unknown) {
  const validatedData = loginSchema.parse(data);

  const user = await prisma.user.findUnique({
    where: {
      email: validatedData.email,
    },
    include: { company: { select: { id: true, name: true, slug: true } } },
  });

  if (!user) {
    throw new Error("Invalid email or password");
  }

  if (!user.active) throw new UnauthorizedError("This account is disabled.");
  if (!user.company || user.company.id !== user.companyId) throw new UnauthorizedError("This account has no valid company association.");

  const isPasswordValid = await comparePassword(validatedData.password, user.password);

  if (!isPasswordValid) {
    throw new Error("Invalid email or password");
  }

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.company.id,
  });

  await prisma.session.create({ data: { token: hashSessionToken(token), userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
  return {
    success: true,
    message: "Login successful",
    token,
    user: sanitizeUser(user),
  };
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: { id: true, name: true, email: true, role: true, active: true, mfaEnabled: true, companyId: true, company: { select: { id: true, name: true, slug: true } } },
  });

  if (!user || !user.active || !user.company || user.company.id !== user.companyId) throw new UnauthorizedError("User account or company association is unavailable.");

  return user;
}
