-- Order details the agent now collects, the GHL conversation behind each order, manual
-- orders taken over the phone, help requests raised by the agent, and the product catalog
-- used by the manual order form.

alter table public.orders
  add column if not exists customer_document text,
  add column if not exists payment_method text,
  add column if not exists conversation_id text,
  add column if not exists source text not null default 'ai',
  add column if not exists last_printed_by text,
  add column if not exists dispatched_by text,
  add column if not exists quoted_total numeric(14, 2),
  add column if not exists quoted_at timestamptz;

-- Phone orders have no GHL contact behind them.
alter table public.orders alter column ghl_contact_id drop not null;

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('ai', 'manual'));
alter table public.orders drop constraint if exists orders_customer_document_length;
alter table public.orders add constraint orders_customer_document_length
  check (customer_document is null or char_length(customer_document) <= 40);
alter table public.orders drop constraint if exists orders_payment_method_length;
alter table public.orders add constraint orders_payment_method_length
  check (payment_method is null or char_length(payment_method) <= 80);
alter table public.orders drop constraint if exists orders_conversation_id_length;
alter table public.orders add constraint orders_conversation_id_length
  check (conversation_id is null or char_length(conversation_id) <= 128);
alter table public.orders drop constraint if exists orders_quoted_total_nonnegative;
alter table public.orders add constraint orders_quoted_total_nonnegative
  check (quoted_total is null or quoted_total >= 0);

create type public.help_request_status as enum ('open', 'resolved');

create table public.help_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete restrict,
  ghl_contact_id text not null,
  conversation_id text,
  customer_name text,
  customer_phone text,
  reason text,
  order_id uuid references public.orders(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  status public.help_request_status not null default 'open',
  request_count integer not null default 1,
  requested_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint help_requests_contact_length check (char_length(ghl_contact_id) between 1 and 128),
  constraint help_requests_conversation_length check (conversation_id is null or char_length(conversation_id) <= 128),
  constraint help_requests_reason_length check (reason is null or char_length(reason) <= 1000)
);

-- One open request per contact: a customer asking twice bumps the existing card instead of
-- stacking duplicates the operator has to clear one by one.
create unique index help_requests_one_open_per_contact
  on public.help_requests (location_id, ghl_contact_id)
  where status = 'open';
create index help_requests_location_status_idx
  on public.help_requests (location_id, status, last_requested_at desc);

create trigger help_requests_set_updated_at
before update on public.help_requests
for each row execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  unit text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint products_name_length check (char_length(name) between 1 and 160),
  constraint products_unit_length check (unit is null or char_length(unit) <= 40),
  constraint products_unique_name unique (location_id, name)
);
create index products_location_name_idx on public.products (location_id, lower(name));

create or replace function public.open_help_request(
  p_location_id uuid,
  p_ghl_contact_id text,
  p_conversation_id text,
  p_customer_name text,
  p_customer_phone text,
  p_reason text,
  p_order_id uuid,
  p_details jsonb
)
returns setof public.help_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with upserted as (
  insert into public.help_requests (
    location_id, ghl_contact_id, conversation_id, customer_name, customer_phone,
    reason, order_id, details
  ) values (
    p_location_id,
    p_ghl_contact_id,
    nullif(btrim(p_conversation_id), ''),
    nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_customer_phone), ''),
    nullif(btrim(p_reason), ''),
    p_order_id,
    coalesce(p_details, '{}'::jsonb)
  )
  on conflict (location_id, ghl_contact_id) where status = 'open'
  do update set
    conversation_id = coalesce(excluded.conversation_id, help_requests.conversation_id),
    customer_name = coalesce(excluded.customer_name, help_requests.customer_name),
    customer_phone = coalesce(excluded.customer_phone, help_requests.customer_phone),
    reason = coalesce(excluded.reason, help_requests.reason),
    order_id = coalesce(excluded.order_id, help_requests.order_id),
    details = help_requests.details || excluded.details,
    request_count = help_requests.request_count + 1,
    last_requested_at = now()
  returning *
  )
  select * from upserted;
end;
$$;

-- The functions below change signature, so the old overloads go first; otherwise
-- PostgREST would see two candidates for the same named call.
drop function if exists public.ingest_order(uuid, text, text, text, text, public.delivery_type, text, jsonb, text, text);
drop function if exists public.amend_order(uuid, text, text, text, text, public.delivery_type, text, jsonb, text, text);
drop function if exists public.confirm_order_print(uuid, uuid, text);
drop function if exists public.dispatch_order(uuid, uuid, text);

create function public.ingest_order(
  p_location_id uuid,
  p_source_event_id text,
  p_ghl_contact_id text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_type public.delivery_type,
  p_delivery_address text,
  p_items jsonb,
  p_notes text,
  p_payload_hash text,
  p_customer_document text default null,
  p_payment_method text default null,
  p_conversation_id text default null,
  p_source text default 'ai'
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
    location_id, source_event_id, ghl_contact_id, customer_name, customer_phone,
    delivery_type, delivery_address, items, notes, payload_hash, search_text,
    customer_document, payment_method, conversation_id, source
  )
  values (
    p_location_id,
    p_source_event_id,
    nullif(btrim(p_ghl_contact_id), ''),
    p_customer_name,
    p_customer_phone,
    p_delivery_type,
    nullif(btrim(p_delivery_address), ''),
    p_items,
    nullif(btrim(p_notes), ''),
    p_payload_hash,
    lower(concat_ws(
      ' ', p_source_event_id, p_ghl_contact_id, p_customer_name, p_customer_phone,
      p_customer_document, p_delivery_address, p_items::text, p_notes
    )),
    nullif(btrim(p_customer_document), ''),
    nullif(btrim(p_payment_method), ''),
    nullif(btrim(p_conversation_id), ''),
    p_source
  )
  on conflict (location_id, source_event_id) do nothing
  returning * into v_order;

  if found then
    insert into public.order_events (order_id, location_id, event_type, request_id, metadata)
    values (v_order.id, v_order.location_id, 'created', p_source_event_id, jsonb_build_object('source', p_source));

    return query select v_order.id, v_order.display_sequence, true, false;
    return;
  end if;

  select * into v_order
  from public.orders
  where location_id = p_location_id and source_event_id = p_source_event_id;

  return query
  select v_order.id, v_order.display_sequence, false, v_order.payload_hash <> p_payload_hash;
end;
$$;

-- An amendment is an adjustment to the same order: it keeps its number. A printed order
-- goes back to pending so it cannot be dispatched until the adjusted ticket is reprinted.
create function public.amend_order(
  p_location_id uuid,
  p_ghl_contact_id text,
  p_source_event_id text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_type public.delivery_type,
  p_delivery_address text,
  p_items jsonb,
  p_notes text,
  p_payload_hash text,
  p_customer_document text default null,
  p_payment_method text default null,
  p_conversation_id text default null
)
returns table (
  order_id uuid,
  display_sequence bigint,
  was_amended boolean,
  needs_reprint boolean,
  outcome text
)
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
  where location_id = p_location_id
    and ghl_contact_id = p_ghl_contact_id
    and status in ('pending', 'printed')
  order by received_at desc
  limit 1
  for update;

  if not found then
    if exists (
      select 1 from public.orders
      where location_id = p_location_id and ghl_contact_id = p_ghl_contact_id
    ) then
      return query select null::uuid, null::bigint, false, false, 'already_dispatched'::text;
    else
      return query select null::uuid, null::bigint, false, false, 'no_order'::text;
    end if;
    return;
  end if;

  insert into public.order_events (order_id, location_id, event_type, request_id, metadata)
  values (
    v_order.id,
    v_order.location_id,
    'amended',
    p_source_event_id,
    jsonb_build_object('previous_status', v_order.status, 'previous_payload_hash', v_order.payload_hash)
  )
  on conflict (order_id, request_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return query
    select v_order.id, v_order.display_sequence, false, v_order.first_printed_at is not null, 'duplicate'::text;
    return;
  end if;

  update public.orders
  set
    customer_name = p_customer_name,
    customer_phone = p_customer_phone,
    delivery_type = p_delivery_type,
    delivery_address = nullif(btrim(p_delivery_address), ''),
    items = p_items,
    notes = nullif(btrim(p_notes), ''),
    customer_document = coalesce(nullif(btrim(p_customer_document), ''), customer_document),
    payment_method = coalesce(nullif(btrim(p_payment_method), ''), payment_method),
    conversation_id = coalesce(nullif(btrim(p_conversation_id), ''), conversation_id),
    payload_hash = p_payload_hash,
    search_text = lower(concat_ws(
      ' ', source_event_id, ghl_contact_id, p_customer_name, p_customer_phone,
      coalesce(nullif(btrim(p_customer_document), ''), customer_document),
      p_delivery_address, p_items::text, p_notes
    )),
    status = 'pending',
    last_amended_at = now(),
    amendment_count = amendment_count + 1
  where id = v_order.id
  returning * into v_order;

  return query
  select v_order.id, v_order.display_sequence, true, v_order.first_printed_at is not null, 'amended'::text;
end;
$$;

create function public.confirm_order_print(
  p_order_id uuid,
  p_location_id uuid,
  p_request_id text,
  p_operator text default null
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

  insert into public.order_events (order_id, location_id, event_type, request_id, metadata)
  values (
    v_order.id,
    v_order.location_id,
    'print_confirmed',
    p_request_id,
    jsonb_build_object('previous_status', v_order.status, 'operator', nullif(btrim(p_operator), ''))
  )
  on conflict (order_id, request_id) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    update public.orders
    set
      status = case when status = 'pending' then 'printed' else status end,
      first_printed_at = coalesce(first_printed_at, now()),
      last_printed_at = now(),
      print_count = print_count + 1,
      last_printed_by = coalesce(nullif(btrim(p_operator), ''), last_printed_by)
    where id = v_order.id
    returning * into v_order;
  end if;

  return next v_order;
end;
$$;

create function public.dispatch_order(
  p_order_id uuid,
  p_location_id uuid,
  p_request_id text,
  p_operator text default null
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

  insert into public.order_events (order_id, location_id, event_type, request_id, metadata)
  values (
    v_order.id,
    v_order.location_id,
    'dispatched',
    p_request_id,
    jsonb_build_object('operator', nullif(btrim(p_operator), ''))
  )
  on conflict (order_id, request_id) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    update public.orders
    set status = 'dispatched', dispatched_at = now(), dispatched_by = nullif(btrim(p_operator), '')
    where id = v_order.id
    returning * into v_order;
  end if;

  return next v_order;
end;
$$;

alter table public.help_requests enable row level security;
alter table public.products enable row level security;
revoke all on public.help_requests from anon, authenticated;
revoke all on public.products from anon, authenticated;
grant all on public.help_requests to service_role;
grant all on public.products to service_role;

revoke execute on function public.open_help_request(uuid, text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.ingest_order(uuid, text, text, text, text, public.delivery_type, text, jsonb, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.amend_order(uuid, text, text, text, text, public.delivery_type, text, jsonb, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.confirm_order_print(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.dispatch_order(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.open_help_request(uuid, text, text, text, text, text, uuid, jsonb) to service_role;
grant execute on function public.ingest_order(uuid, text, text, text, text, public.delivery_type, text, jsonb, text, text, text, text, text, text) to service_role;
grant execute on function public.amend_order(uuid, text, text, text, text, public.delivery_type, text, jsonb, text, text, text, text, text) to service_role;
grant execute on function public.confirm_order_print(uuid, uuid, text, text) to service_role;
grant execute on function public.dispatch_order(uuid, uuid, text, text) to service_role;
