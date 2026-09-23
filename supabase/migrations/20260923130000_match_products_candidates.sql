-- Trigram similarity alone favors short names that look alike letter by letter, so
-- "pechuga de pollo troceada" landed on LECHUGA. Return several candidates per line
-- and let the app pick the one that shares the most whole words with the request.
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
  select ranked.input_index, ranked.id, ranked.reference, ranked.name, ranked.category, ranked.subcategory,
         ranked.sale_note, ranked.price, ranked.price_unit, ranked.price_updated_at, ranked.score
  from (
    select
      input.ordinality::integer - 1 as input_index,
      p.id, p.reference, p.name, p.category, p.subcategory, p.sale_note,
      p.price, p.price_unit, p.price_updated_at,
      greatest(similarity(p.search_name, input.query), word_similarity(p.search_name, input.query)) as score,
      row_number() over (
        partition by input.ordinality
        order by greatest(similarity(p.search_name, input.query), word_similarity(p.search_name, input.query)) desc
      ) as position
    from unnest(p_names) with ordinality as input(query, ordinality)
    join public.products p
      on p.location_id = p_location_id
     and p.is_active
     and (p.search_name % input.query or p.search_name <% input.query or input.query like '%' || split_part(p.search_name, ' ', 1) || '%')
  ) ranked
  where ranked.position <= 12
  order by ranked.input_index, ranked.position;
$$;
