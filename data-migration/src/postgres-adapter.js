const { PrismaPg } = require('@prisma/adapter-pg');

function createPostgresAdapter(connectionString) {
  if (!connectionString) throw new Error('A PostgreSQL connection URL is required');
  const schema = new URL(connectionString).searchParams.get('schema') || undefined;
  return new PrismaPg({ connectionString }, { schema });
}

module.exports = { createPostgresAdapter };
