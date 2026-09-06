const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const adminExists = await prisma.user.findFirst({
    where: { role: "ADMIN" },
  });

  if (adminExists) {
    console.error("Bootstrap rejected: an ADMIN already exists.");
    process.exitCode = 1;
    return;
  }

  const name = requireEnv("COMMANDER_BOOTSTRAP_NAME");
  const email = requireEnv("COMMANDER_BOOTSTRAP_EMAIL");
  const password = requireEnv("COMMANDER_BOOTSTRAP_PASSWORD");

  const company = await prisma.company.findFirst();
  if (!company) {
    throw new Error("No company exists. Create a company before bootstrapping the first admin.");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: "ADMIN",
      companyId: company.id,
    },
  });

  console.log("First admin bootstrap successful.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Bootstrap failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
