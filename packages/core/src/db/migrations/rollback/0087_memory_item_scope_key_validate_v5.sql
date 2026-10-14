-- REVERSE of 0087. VALIDATE CONSTRAINT has no catalog-visible effect to undo beyond marking the
-- three constraints validated; nothing to reverse here. Delete the 0087 entry from
-- drizzle.__drizzle_migrations, then roll back 0086, 0085, 0084 in that order.
SELECT 1;
