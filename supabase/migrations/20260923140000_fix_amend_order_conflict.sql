-- amend_order failed on every real amendment with "column reference order_id is
-- ambiguous": the ON CONFLICT column list clashes with the function's output column of
-- the same name. Same function, with the conflict target named by constraint.

-- An amendment is an adjustment to the same order: it keeps its number. A printed order
-- goes back to pending so it cannot be dispatched until the adjusted ticket is reprinted.
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
  -- By constraint name: the output column `order_id` makes the column list ambiguous.
  on conflict on constraint order_events_request_unique do nothing
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
