-- Priced product catalog (imported from Frutitodo's reference sheets) and quotes built on
-- top of an order: the operator prices each line, the total is computed on the server and
-- the quote is sent to the customer through the GHL API.

create extension if not exists pg_trgm with schema extensions;

alter table public.products
  add column if not exists reference text,
  add column if not exists category text,
  add column if not exists subcategory text,
  add column if not exists sale_note text,
  add column if not exists price numeric(14, 2),
  add column if not exists price_unit text,
  add column if not exists price_updated_at timestamptz,
  add column if not exists price_updated_by text,
  add column if not exists search_name text,
  add column if not exists updated_at timestamptz not null default now();

-- Products created before this migration had no reference or search key.
update public.products
set
  reference = coalesce(reference, 'MAN-' || substr(id::text, 1, 8)),
  price_unit = coalesce(price_unit, unit),
  search_name = coalesce(search_name, lower(name))
where reference is null or search_name is null;

alter table public.products alter column reference set not null;
alter table public.products alter column search_name set not null;

-- The reference (SKU or barcode) identifies a product; names can repeat across brands.
alter table public.products drop constraint if exists products_unique_name;
alter table public.products drop constraint if exists products_unique_reference;
alter table public.products add constraint products_unique_reference unique (location_id, reference);
alter table public.products drop constraint if exists products_reference_length;
alter table public.products add constraint products_reference_length check (char_length(reference) between 1 and 64);
alter table public.products drop constraint if exists products_price_nonnegative;
alter table public.products add constraint products_price_nonnegative check (price is null or price >= 0);
alter table public.products drop constraint if exists products_price_unit_length;
alter table public.products add constraint products_price_unit_length check (price_unit is null or char_length(price_unit) <= 40);

drop index if exists public.products_location_name_idx;
create index if not exists products_search_trgm_idx
  on public.products using gin (search_name extensions.gin_trgm_ops);
create index if not exists products_location_category_idx
  on public.products (location_id, category, search_name);

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

alter table public.orders
  add column if not exists quote jsonb,
  add column if not exists quote_request_id text,
  add column if not exists quote_sent_by text,
  add column if not exists quote_message_id text;

-- Search ranked by closeness, so "pechuga" finds "PECHUGA DE POLLO" before
-- "PECHUGA DE PAVO X 500G" and small typos still match. `p_query` arrives already
-- lowercased and without accents, the same normalization as `search_name`.
create or replace function public.search_products(
  p_location_id uuid,
  p_query text,
  p_category text,
  p_priced text,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  reference text,
  name text,
  category text,
  subcategory text,
  sale_note text,
  price numeric,
  price_unit text,
  price_updated_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p.id, p.reference, p.name, p.category, p.subcategory, p.sale_note,
    p.price, p.price_unit, p.price_updated_at,
    count(*) over () as total_count
  from public.products p
  where p.location_id = p_location_id
    and p.is_active
    and (p_category is null or p.category = p_category)
    and (
      p_priced is null
      or (p_priced = 'priced' and p.price is not null)
      or (p_priced = 'unpriced' and p.price is null)
    )
    and (
      p_query is null
      or p.search_name like '%' || p_query || '%'
      or p.reference = p_query
      or p.search_name % p_query
    )
  order by
    case when p_query is null then 0 when p.search_name like p_query || '%' then 0 else 1 end,
    case when p_query is null then 0 else 1 - similarity(p.search_name, p_query) end,
    p.name
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;

-- Best catalog match for each order line, used to prefill a quote. Word similarity lets
-- "2 kg pechuga troceada" land on "PECHUGA" even though the line has extra words.
create or replace function public.match_products(
  p_location_id uuid,
  p_names text[]
)
returns table (
  input_index integer,
  id uuid,
  reference text,
  name text,
  category text,
  subcategory text,
  sale_note text,
  price numeric,
  price_unit text,
  price_updated_at timestamptz,
  score real
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select distinct on (input.ordinality)
    input.ordinality::integer - 1,
    p.id, p.reference, p.name, p.category, p.subcategory, p.sale_note,
    p.price, p.price_unit, p.price_updated_at,
    greatest(similarity(p.search_name, input.query), word_similarity(p.search_name, input.query)) as score
  from unnest(p_names) with ordinality as input(query, ordinality)
  join public.products p
    on p.location_id = p_location_id
   and p.is_active
   and (p.search_name % input.query or p.search_name <% input.query)
  order by
    input.ordinality,
    -- Priced products first: a match without a price does not help the quote.
    (p.price is null),
    greatest(similarity(p.search_name, input.query), word_similarity(p.search_name, input.query)) desc,
    char_length(p.name);
$$;

create or replace function public.product_categories(p_location_id uuid)
returns table (category text, total bigint, priced bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.category, count(*), count(p.price)
  from public.products p
  where p.location_id = p_location_id and p.is_active and p.category is not null
  group by p.category
  order by p.category;
$$;

revoke execute on function public.search_products(uuid, text, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.match_products(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.product_categories(uuid) from public, anon, authenticated;
grant execute on function public.search_products(uuid, text, text, text, integer, integer) to service_role;
grant execute on function public.match_products(uuid, text[]) to service_role;
grant execute on function public.product_categories(uuid) to service_role;
