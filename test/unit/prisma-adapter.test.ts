import { expect } from 'chai';
import {
  createPostgresAdapter,
  getPostgresSchema,
} from '../../src/common/prisma-adapter';

describe('Prisma PostgreSQL adapter helper', () => {
  it('preserves the schema query parameter for the driver adapter', () => {
    const connectionString =
      'postgresql://user:password@localhost:5432/topcoder?schema=challenges';

    expect(getPostgresSchema(connectionString)).to.equal('challenges');
    expect(
      createPostgresAdapter(connectionString, 'DATABASE_URL'),
    ).to.have.property('provider', 'postgres');
  });

  it('returns no schema when the URL does not select one', () => {
    expect(
      getPostgresSchema('postgresql://user:password@localhost:5432/topcoder'),
    ).to.equal(undefined);
  });

  it('leaves malformed URLs for the PostgreSQL driver to validate', () => {
    expect(getPostgresSchema('not a PostgreSQL URL')).to.equal(undefined);
  });

  it('reports the existing environment variable when a URL is missing', () => {
    expect(() => createPostgresAdapter(undefined, 'REVIEW_DB_URL')).to.throw(
      'REVIEW_DB_URL is not configured',
    );
  });
});
