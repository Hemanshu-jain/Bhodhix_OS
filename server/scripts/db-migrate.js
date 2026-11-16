const { createPool, migrate } = require('../src/postgres');

async function main() {
  const pool = createPool();
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied PostgreSQL migrations: ${applied.join(', ')}` : 'PostgreSQL schema is up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`PostgreSQL migration failed: ${error.message}`);
  process.exitCode = 1;
});
