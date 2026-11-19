import knexFactory from 'knex';

/** Fails fast with a clear message if the test database is missing; never touches non-test databases. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/stmarys_test';
  if (!/test/.test(url)) throw new Error(`Refusing to run tests against a non-test database: ${url}`);
  const k = knexFactory({ client: 'pg', connection: url });
  try {
    await k.raw('select 1');
  } catch (err) {
    throw new Error(`Test database not reachable (${url}). Create it with: createdb stmarys_test\n${String(err)}`);
  } finally {
    await k.destroy();
  }
}
