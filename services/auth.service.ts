import { prisma } from "@/lib/prisma";
import { hashPassword, comparePassword } from "@/lib/bcrypt";
import { generateToken } from "@/lib/jwt";
import { registerSchema, loginSchema } from "@/validators/auth.validator";
import { UserRole } from "@prisma/client";

export async function registerUser(data: unknown) {
  // Validate input
  const validatedData = registerSchema.parse(data);

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: {
      email: validatedData.email,
    },
  });

  if (existingUser) {
    throw new Error("User already exists");
  }

  // Generate company slug
  const slug = validatedData.companyName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");

  // Hash password
  const hashedPassword = await hashPassword(validatedData.password);

  // Create company and first admin user in a transaction
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

  // Generate JWT
  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  });

  return {
    message: "Company and admin user created successfully",
    token,
    user,
    company,
  };
}

export async function loginUser(data: unknown) {
  // Validate input
  const validatedData = loginSchema.parse(data);

  // Find user
  const user = await prisma.user.findUnique({
    where: {
      email: validatedData.email,
    },
  });

  if (!user) {
    throw new Error("Invalid email or password");
  }

  // Compare password
  const isPasswordValid = await comparePassword(
    validatedData.password,
    user.password
  );

  if (!isPasswordValid) {
    throw new Error("Invalid email or password");
  }

  // Generate JWT
  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  });

  return {
    message: "Login successful",
    token,
    user,
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

  return user;
}