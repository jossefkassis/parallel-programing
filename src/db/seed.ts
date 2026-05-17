import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { products, users, wallets } from './schema';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ecommerce_demo_nest?schema=public' });
  const db = drizzle(pool);

  await pool.query('TRUNCATE TABLE order_items, orders, wallets, users, products, job_logs RESTART IDENTITY CASCADE');

  const [user] = await db.insert(users).values({ name: 'Demo User', email: 'demo@example.com' }).returning();
  await db.insert(wallets).values({ userId: user.id, balance: '10000.00' });
  await db.insert(products).values([
    { name: 'Keyboard', price: '120.00', stock: 100 },
    { name: 'Mouse', price: '80.00', stock: 100 },
    { name: 'Monitor', price: '900.00', stock: 40 },
  ]);
  console.log({ userId: user.id });
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
