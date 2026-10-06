const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const passages = await prisma.passage.findMany({ where: { textId: 'enoch' }, take: 2 });
  console.log(passages);
}
main().catch(console.error).finally(() => prisma.$disconnect());
