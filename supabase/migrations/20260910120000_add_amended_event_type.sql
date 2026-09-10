-- Separate migration: a new enum value cannot be used in the same transaction that
-- adds it, and the amendment function in the next migration depends on this one.
alter type public.order_event_type add value if not exists 'amended';
