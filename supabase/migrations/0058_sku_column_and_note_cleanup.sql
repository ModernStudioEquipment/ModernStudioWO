-- 0058: give the QuickBooks item code a column of its own, and undo a bad
-- backfill from 0057.
--
-- TWO PROBLEMS, one cause: `items.note` was doing two jobs.
--
-- The QuickBooks sync writes the item code into the product's NOTE as
-- "Item #: 013-2410-BZ", and itemSku() parses it back out to match product
-- photos. items.sku existed (0033) but was never populated — every one of the
-- 6,595 items had it empty, so that note text was the only copy.
--
-- 1. Adding a note to a product mirrors the new text into items.note, which
--    OVERWRITES the code and permanently breaks that product's photo. Filling
--    items.sku fixes it: itemSku() prefers the column, so the note is free to
--    hold what a person actually wrote.
--
-- 2. 0057 copied every non-empty items.note into the notes log, so 2,838 SKU
--    strings became "notes" reading "Item #: 006-1686 — author unknown". They
--    are machine data, not anything a person wrote.

-- --- 1. The item code gets its own column ---------------------------------
-- Everything after "Item #:" up to the end of the line. Only where sku is still
-- empty, so a real value already set is never clobbered.
update public.items
   set sku = trim(substring(note from 'Item #:\s*([^\r\n]+)'))
 where sku is null
   and note ~ 'Item #:';

-- --- 2. Drop the SKU-only rows 0057 created --------------------------------
-- ONE LINE beginning "Item #:" is the code and nothing else. A note with any
-- further line is prose somebody wrote after it — nine of those exist and are
-- deliberately kept, e.g.
--     Item #: 040-7661
--     Per "Notes" on invoice: Order must be picked up by (08/…
delete from public.notes
 where subject_type = 'item'
   and body ~ '^Item #:'
   and body !~ '[\r\n]';
