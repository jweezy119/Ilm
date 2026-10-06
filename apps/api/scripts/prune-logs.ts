import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Pruning search logs older than 30 days...');
  
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  try {
    const { count } = await prisma.searchLog.deleteMany({
      where: {
        createdAt: {
          lt: thirtyDaysAgo,
        },
      },
    });
    
    console.log(`Successfully deleted ${count} old search logs.`);
  } catch (error) {
    console.error('Failed to prune search logs:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
