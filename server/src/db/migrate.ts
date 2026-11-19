import { db } from './knex.js';

const cmd = process.argv[2] ?? 'latest';

async function main() {
  if (cmd === 'latest') {
    const [batch, files] = await db.migrate.latest();
    console.log(files.length ? `Batch ${batch}: ran ${files.join(', ')}` : 'Database already up to date');
  } else if (cmd === 'rollback') {
    const [batch, files] = await db.migrate.rollback();
    console.log(files.length ? `Rolled back batch ${batch}: ${files.join(', ')}` : 'Nothing to roll back');
  } else {
    throw new Error('Usage: migrate.ts latest|rollback');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
