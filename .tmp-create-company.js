const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.upsert({
    where: { slug: "default-company" },
    update: {},
    create: { name: "Default Company", slug: "default-company" }
  });
  console.log("Company ready:", company.id, company.slug);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
