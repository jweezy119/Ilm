import { runFullText } from './src/services/search';

async function test() {
  const query = "angel"; 
  const searchQuery = {
    query,
    limit: 5,
    offset: 0,
    includeScores: false,
    semantic: false,
    expand: false,
    filters: { texts: ['quran'] },
  };
  const result = await runFullText(query, searchQuery as any);
  console.log(`Quran results for 'angel': ${result.hits.length}`);
}

test().catch(console.error);
