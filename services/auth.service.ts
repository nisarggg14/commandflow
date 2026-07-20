import { prisma } from "@/lib/prisma";
import { hashPassword, comparePassword } from "@/lib/bcrypt";
import { generateToken } from "@/lib/jwt";
import { registerSchema, loginSchema } from "@/validators/auth.validator";
import { UserRole } from "@prisma/client";

function sanitizeUser(user: { [key: string]: unknown }) {
  const { password, ...rest } = user;
  return rest;
}

export async function registerUser(data: unknown) {
  const validatedData = registerSchema.parse(data);

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
        role: UserRole.ADMIN,
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
  });

  if (!user) {
    throw new Error("Invalid email or password");
  }

  const isPasswordValid = await comparePassword(validatedData.password, user.password);

  if (!isPasswordValid) {
    throw new Error("Invalid email or password");
  }

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  });

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
    include: {
      company: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const { password, ...sanitizedUser } = user;
  return sanitizedUser;
}