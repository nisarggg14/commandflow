require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

const DEFAULT_COMPANY_NAME = "Default Company";
const DEFAULT_COMPANY_SLUG = "default-company";
const DEFAULT_ADMIN_EMAIL = "admin@commandflow.com";
const DEFAULT_ADMIN_NAME = "Admin";

function readEnv(name, fallback) {
  const value = process.env[name];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

async function main() {
  const company = await prisma.company.upsert({
    where: { slug: DEFAULT_COMPANY_SLUG },
    update: {
      name: DEFAULT_COMPANY_NAME,
    },
    create: {
      name: DEFAULT_COMPANY_NAME,
      slug: DEFAULT_COMPANY_SLUG,
    },
  });

  const adminEmail = readEnv("COMMANDER_BOOTSTRAP_EMAIL", DEFAULT_ADMIN_EMAIL);
  const adminName = readEnv("COMMANDER_BOOTSTRAP_NAME", DEFAULT_ADMIN_NAME);
  const adminPassword = readEnv("COMMANDER_BOOTSTRAP_PASSWORD", "admin123");

  let adminUser = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!adminUser) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    adminUser = await prisma.user.create({
      data: {
        name: adminName,
        email: adminEmail,
        password: hashedPassword,
        role: "ADMIN",
        companyId: company.id,
      },
    });
  } else {
    adminUser = await prisma.user.update({
      where: { id: adminUser.id },
      data: {
        name: adminName,
        role: "ADMIN",
        companyId: company.id,
      },
    });
  }

  console.log(`Demo environment ready. Company ensured: ${company.name} (${company.slug}). Admin ensured: ${adminUser.email}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Bootstrap failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
