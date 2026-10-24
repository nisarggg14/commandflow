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
  const defaultCompanyNormalized = DEFAULT_COMPANY_NAME.trim().toLowerCase();
  const company = await prisma.company.upsert({
    where: { slug: DEFAULT_COMPANY_SLUG },
    update: {
      name: DEFAULT_COMPANY_NAME,
      normalizedName: defaultCompanyNormalized,
    },
    create: {
      name: DEFAULT_COMPANY_NAME,
      normalizedName: defaultCompanyNormalized,
      slug: DEFAULT_COMPANY_SLUG,
    },
  });

  const adminEmail = readEnv("COMMANDER_BOOTSTRAP_EMAIL", DEFAULT_ADMIN_EMAIL);
  const adminName = readEnv("COMMANDER_BOOTSTRAP_NAME", DEFAULT_ADMIN_NAME);
  if (process.env.NODE_ENV === "production" && !process.env.COMMANDER_BOOTSTRAP_PASSWORD) throw new Error("COMMANDER_BOOTSTRAP_PASSWORD is required in production.");

  const adminPassword = readEnv("COMMANDER_BOOTSTRAP_PASSWORD", "admin123");

  let adminUser = await prisma.user.findFirst({
    where: { email: adminEmail, companyId: company.id },
  });

  if (!adminUser) {
    const existingElsewhere = await prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true, companyId: true },
    });
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    if (existingElsewhere) {
      adminUser = await prisma.user.update({
        where: { id: existingElsewhere.id },
        data: {
          name: adminName,
          password: hashedPassword,
          role: "ADMIN",
          active: true,
        },
      });
    } else {
      adminUser = await prisma.user.create({
        data: {
          name: adminName,
          email: adminEmail,
          password: hashedPassword,
          role: "ADMIN",
          active: true,
          companyId: company.id,
        },
      });
    }
  } else {
    adminUser = await prisma.user.update({
      where: { id: adminUser.id },
      data: {
        name: adminName,
        role: "ADMIN",
        active: true,
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
