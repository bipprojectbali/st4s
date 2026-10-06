/** Subprocess helper for the sidecar tests (`exec <sql>` prints the first row; postgres-js reads PGHOST from process.env, so each scenario is its own process). */
import postgres from 'postgres';
import { bootLocalPg, stopLocalPg } from '../../server/local-pg/boot';

await bootLocalPg();
if (process.argv[2] === 'hold') {
  console.log(`READY ${process.pid}`);
  setInterval(() => {}, 1 << 30);
} else {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });
  const [row] =
    process.argv[2] === 'exec'
      ? await sql.unsafe(process.argv[3] as string)
      : await sql`select current_setting('TimeZone') as tz, current_user as usr, (select count(*)::int from drizzle.__drizzle_migrations) as migrations`;
  await sql.end();
  await stopLocalPg();
  console.log(JSON.stringify(row));
}
