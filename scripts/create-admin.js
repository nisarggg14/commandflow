const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.findFirst();

  if (!company) {
    throw new Error("No company found. Create a company before running this script.");
  }

  const password = await bcrypt.hash("admin123", 10);

  await prisma.user.create({
    data: {
      name: "Admin",
      email: "admin@commandflow.com",
      password,
      role: "ADMIN",
      companyId: company.id,
    },
  });

  console.log("✅ Admin user created");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
