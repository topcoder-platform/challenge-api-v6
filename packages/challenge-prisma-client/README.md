# `@topcoder/challenge-api-v6`

This package is the supported external Prisma client for the Challenge API v6
schema. It re-exports the generated Prisma surface and provides
`createChallengePrismaClient(connectionString, options?)`, which configures the
Prisma 7 PostgreSQL driver adapter and honors the connection URL's optional
`schema` query parameter.

```ts
import { createChallengePrismaClient } from '@topcoder/challenge-api-v6';

const client = createChallengePrismaClient(process.env.CHALLENGE_DATABASE_URL);
const activeCount = await client.challenge.count({
  where: { status: 'ACTIVE' },
});
await client.$disconnect();
```

The client connects lazily. Applications own its lifecycle and must disconnect
it during shutdown. An empty or non-string connection URL raises `TypeError`;
Prisma reports its normal configuration and database errors during creation or
query execution.
