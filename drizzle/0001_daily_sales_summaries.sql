CREATE TABLE "daily_sales_summaries" (
  "id" serial PRIMARY KEY NOT NULL,
  "sales_date" timestamp NOT NULL,
  "processed_orders" integer NOT NULL,
  "total_revenue" numeric(12, 2) NOT NULL,
  "chunk_size" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
