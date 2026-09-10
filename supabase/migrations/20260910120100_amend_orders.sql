alter table public.orders
  add column if not exists last_amended_at timestamptz,
  add column if not exists amendment_count integer not null default 0;

alter table public.orders
  drop constraint if exists orders_amendment_count_nonnegative;
alter table public.orders
  add constraint orders_amendment_count_nonnegative check (amendment_count >= 0);

create index if not exists orders_location_contact_open_idx
  on public.orders (location_id, ghl_contact_id, received_at desc)
  where status in ('pending', 'printed');

-- Replaces the contents of the open order for a contact. The agent re-reads the whole
-- conversation on every change, so an amendment always carries the complete order and
-- overwrites rather than merges.
create or replace function public.amend_order(
  p_location_id uuid,
  p_ghl_contact_id text,
  p_source_event_id text,
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
  v_was_printed boolean;
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
    -- Tell the caller apart: an order that already left is a different situation from
    -- a contact that never had one, and each needs a different reaction upstream.
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

  insert into public.order_events (
    order_id,
    location_id,
    event_type,
    request_id,
    metadata
  ) values (
    v_order.id,
    v_order.location_id,
    'amended',
    p_source_event_id,
    jsonb_build_object(
      'previous_status', v_order.status,
      'previous_payload_hash', v_order.payload_hash
    )
  )
  on conflict (order_id, request_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    -- This exact amendment already landed; a retry must not bump the counter again.
    return query
    select
      v_order.id,
      v_order.display_sequence,
      false,
      v_order.first_printed_at is not null,
      'duplicate'::text;
    return;
  end if;

  v_was_printed := v_order.first_printed_at is not null;

  update public.orders
  set
    customer_name = p_customer_name,
    customer_phone = p_customer_phone,
    delivery_type = p_delivery_type,
    delivery_address = nullif(btrim(p_delivery_address), ''),
    items = p_items,
    notes = nullif(btrim(p_notes), ''),
    payload_hash = p_payload_hash,
    search_text = lower(concat_ws(
      ' ',
      source_event_id,
      ghl_contact_id,
      p_customer_name,
      p_customer_phone,
      p_delivery_address,
      p_items::text,
      p_notes
    )),
    -- The printed ticket is now stale, so the order returns to the queue: dispatching
    -- still requires a confirmed print, which forces the reprint.
    status = 'pending',
    last_amended_at = now(),
    amendment_count = amendment_count + 1
  where id = v_order.id
  returning * into v_order;

  return query
  select v_order.id, v_order.display_sequence, true, v_was_printed, 'amended'::text;
end;
$$;

revoke execute on function public.amend_order(
  uuid, text, text, text, text, public.delivery_type, text, jsonb, text, text
) from public, anon, authenticated;

grant execute on function public.amend_order(
  uuid, text, text, text, text, public.delivery_type, text, jsonb, text, text
) to service_role;
