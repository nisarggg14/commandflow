const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.findFirst();

  if (!company) {
    throw new Error("No company found. Create a company before running this script.");
  }

  const rawPassword = process.env.COMMANDER_BOOTSTRAP_PASSWORD;

  if (!rawPassword || (process.env.NODE_ENV === "production" && rawPassword === "admin123")) throw new Error("A non-default COMMANDER_BOOTSTRAP_PASSWORD is required.");

  const password = await bcrypt.hash(rawPassword, 10);

  await prisma.user.create({
    data: {
      name: "Admin",
      email: "admin@commandflow.com",
      password,
      role: "ADMIN",
      companyId: company.id,
    },
  });

  console.log("âœ… Admin user created");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
