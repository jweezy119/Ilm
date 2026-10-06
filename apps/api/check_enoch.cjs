const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.passage.count({ where: { textId: 'enoch' } });
  console.log(`Enoch passages: ${count}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
