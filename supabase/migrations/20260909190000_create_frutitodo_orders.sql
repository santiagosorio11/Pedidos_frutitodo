create extension if not exists pgcrypto;

create type public.order_status as enum ('pending', 'printed', 'dispatched');
create type public.delivery_type as enum ('domicilio', 'recogida');
create type public.order_event_type as enum ('created', 'print_confirmed', 'dispatched');

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  ghl_location_id text not null unique,
  name text not null,
  embed_token_hash text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_ghl_location_id_length check (char_length(ghl_location_id) between 3 and 128),
  constraint locations_name_length check (char_length(name) between 1 and 120),
  constraint locations_embed_token_hash_format check (embed_token_hash ~ '^[a-f0-9]{64}$')
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  display_sequence bigint generated always as identity unique,
  location_id uuid not null references public.locations(id) on delete restrict,
  source_event_id text not null,
  ghl_contact_id text not null,
  customer_name text not null,
  customer_phone text not null,
  delivery_type public.delivery_type not null,
  delivery_address text,
  items jsonb not null,
  notes text,
  status public.order_status not null default 'pending',
  payload_hash text not null,
  search_text text not null,
  received_at timestamptz not null default now(),
  first_printed_at timestamptz,
  last_printed_at timestamptz,
  print_count integer not null default 0,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_source_event_id_length check (char_length(source_event_id) between 8 and 128),
  constraint orders_ghl_contact_id_length check (char_length(ghl_contact_id) between 1 and 128),
  constraint orders_customer_name_length check (char_length(customer_name) between 1 and 160),
  constraint orders_customer_phone_length check (char_length(customer_phone) between 3 and 40),
  constraint orders_address_length check (delivery_address is null or char_length(delivery_address) <= 500),
  constraint orders_notes_length check (notes is null or char_length(notes) <= 2000),
  constraint orders_items_array check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 100
  ),
  constraint orders_payload_hash_format check (payload_hash ~ '^[a-f0-9]{64}$'),
  constraint orders_print_count_nonnegative check (print_count >= 0),
  constraint orders_domicilio_address check (
    delivery_type = 'recogida'
    or nullif(btrim(delivery_address), '') is not null
  ),
  constraint orders_source_event_unique unique (location_id, source_event_id)
);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  event_type public.order_event_type not null,
  request_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_events_request_id_length check (char_length(request_id) between 8 and 128),
  constraint order_events_request_unique unique (order_id, request_id)
);

create index orders_location_status_received_idx
  on public.orders (location_id, status, received_at desc);
create index orders_location_received_idx
  on public.orders (location_id, received_at desc);
create index orders_location_delivery_idx
  on public.orders (location_id, delivery_type, received_at desc);
create index order_events_order_created_idx
  on public.order_events (order_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger locations_set_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.ingest_order(
  p_location_id uuid,
  p_source_event_id text,
  p_ghl_contact_id text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_type public.delivery_type,
  p_delivery_address text,
  p_items jsonb,
  p_notes text,
  p_payload_hash text
)
returns table (
  order_id uuid,
  display_sequence bigint,
  was_created boolean,
  payload_conflict boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  insert into public.orders (
    location_id,
    source_event_id,
    ghl_contact_id,
    customer_name,
    customer_phone,
    delivery_type,
    delivery_address,
    items,
    notes,
    payload_hash,
    search_text
  )
  values (
    p_location_id,
    p_source_event_id,
    p_ghl_contact_id,
    p_customer_name,
    p_customer_phone,
    p_delivery_type,
    nullif(btrim(p_delivery_address), ''),
    p_items,
    nullif(btrim(p_notes), ''),
    p_payload_hash,
    lower(concat_ws(
      ' ',
      p_source_event_id,
      p_ghl_contact_id,
      p_customer_name,
      p_customer_phone,
      p_delivery_address,
      p_items::text,
      p_notes
    ))
  )
  on conflict (location_id, source_event_id) do nothing
  returning * into v_order;

  if found then
    insert into public.order_events (
      order_id,
      location_id,
      event_type,
      request_id,
      metadata
    ) values (
      v_order.id,
      v_order.location_id,
      'created',
      p_source_event_id,
      jsonb_build_object('source', 'ghl')
    );

    return query select v_order.id, v_order.display_sequence, true, false;
    return;
  end if;

  select * into v_order
  from public.orders
  where location_id = p_location_id
    and source_event_id = p_source_event_id;

  return query
  select v_order.id, v_order.display_sequence, false, v_order.payload_hash <> p_payload_hash;
end;
$$;

create or replace function public.confirm_order_print(
  p_order_id uuid,
  p_location_id uuid,
  p_request_id text
)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_event_id uuid;
begin
  select * into v_order
  from public.orders
  where id = p_order_id and location_id = p_location_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.order_events (
    order_id,
    location_id,
    event_type,
    request_id,
    metadata
  ) values (
    v_order.id,
    v_order.location_id,
    'print_confirmed',
    p_request_id,
    jsonb_build_object('previous_status', v_order.status)
  )
  on conflict (order_id, request_id) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    update public.orders
    set
      status = case when status = 'pending' then 'printed' else status end,
      first_printed_at = coalesce(first_printed_at, now()),
      last_printed_at = now(),
      print_count = print_count + 1
    where id = v_order.id
    returning * into v_order;
  end if;

  return next v_order;
end;
$$;

create or replace function public.dispatch_order(
  p_order_id uuid,
  p_location_id uuid,
  p_request_id text
)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_event_id uuid;
begin
  select * into v_order
  from public.orders
  where id = p_order_id and location_id = p_location_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_order.status = 'pending' then
    raise exception 'ORDER_NOT_PRINTED' using errcode = 'P0001';
  end if;

  if v_order.status = 'dispatched' then
    return next v_order;
    return;
  end if;

  insert into public.order_events (
    order_id,
    location_id,
    event_type,
    request_id,
    metadata
  ) values (
    v_order.id,
    v_order.location_id,
    'dispatched',
    p_request_id,
    '{}'::jsonb
  )
  on conflict (order_id, request_id) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    update public.orders
    set status = 'dispatched', dispatched_at = now()
    where id = v_order.id
    returning * into v_order;
  end if;

  return next v_order;
end;
$$;

alter table public.locations enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;

revoke all on public.locations from anon, authenticated;
revoke all on public.orders from anon, authenticated;
revoke all on public.order_events from anon, authenticated;
revoke execute on function public.ingest_order(uuid, text, text, text, text, public.delivery_type, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.confirm_order_print(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.dispatch_order(uuid, uuid, text) from public, anon, authenticated;

grant all on public.locations to service_role;
grant all on public.orders to service_role;
grant all on public.order_events to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.ingest_order(uuid, text, text, text, text, public.delivery_type, text, jsonb, text, text) to service_role;
grant execute on function public.confirm_order_print(uuid, uuid, text) to service_role;
grant execute on function public.dispatch_order(uuid, uuid, text) to service_role;
