-- Run this in Supabase SQL Editor > New Query
-- Creates the product library tables

-- Product library (per user/vehicle)
CREATE TABLE IF NOT EXISTS products (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users NOT NULL,
  vehicle_id  uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  brand       text,
  notes       text,
  created_at  timestamptz DEFAULT now()
);

-- Buy links (multiple per product)
CREATE TABLE IF NOT EXISTS product_links (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id  uuid REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  label       text NOT NULL DEFAULT 'Buy',
  url         text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- Product <-> service category associations
CREATE TABLE IF NOT EXISTS product_category_links (
  product_id  uuid REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  category_id uuid REFERENCES service_categories(id) ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (product_id, category_id)
);

-- RLS
ALTER TABLE products               ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_links          ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_category_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user owns products"
  ON products FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "user owns product_links"
  ON product_links FOR ALL
  USING (
    EXISTS (SELECT 1 FROM products WHERE products.id = product_links.product_id AND products.user_id = auth.uid())
  );

CREATE POLICY "user owns product_category_links"
  ON product_category_links FOR ALL
  USING (
    EXISTS (SELECT 1 FROM products WHERE products.id = product_category_links.product_id AND products.user_id = auth.uid())
  );
