import { relations } from 'drizzle-orm';
import { integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const orderStatus = pgEnum('order_status', ['pending_payment', 'confirmed', 'payment_failed']);
export const paymentStatus = pgEnum('payment_status', ['pending', 'succeeded', 'failed']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const wallets = pgTable('wallets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  balance: numeric('balance', { precision: 12, scale: 2 }).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [uniqueIndex('wallets_user_id_idx').on(table.userId)]);

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  stock: integer('stock').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  status: orderStatus('status').default('pending_payment').notNull(),
  paymentStatus: paymentStatus('payment_status').default('pending').notNull(),
  total: numeric('total', { precision: 12, scale: 2 }).notNull(),
  fakePaymentRef: text('fake_payment_ref').unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
});

export const jobLogs = pgTable('job_logs', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const dailySalesSummaries = pgTable('daily_sales_summaries', {
  id: serial('id').primaryKey(),
  salesDate: timestamp('sales_date').notNull(),
  processedOrders: integer('processed_orders').notNull(),
  totalRevenue: numeric('total_revenue', { precision: 12, scale: 2 }).notNull(),
  chunkSize: integer('chunk_size').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  wallet: one(wallets),
  orders: many(orders),
}));
