import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Prisma generation does not need a live datasource, while migrate commands
    // continue to use the service's existing DATABASE_URL environment variable.
    url: process.env.DATABASE_URL ?? '',
  },
});
