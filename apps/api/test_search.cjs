const { runFullText } = require('./dist/services/search.js');

async function test() {
  const query = "angel"; // Enoch has lots of angels
  const searchQuery = {
    query,
    limit: 5,
    offset: 0,
    includeScores: false,
    semantic: false,
    expand: false,
    filters: { texts: ['enoch'] },
  };
  const result = await runFullText(query, searchQuery);
  console.log(`Enoch results for 'angel': ${result.hits.length}`);
}

test().catch(console.error);
