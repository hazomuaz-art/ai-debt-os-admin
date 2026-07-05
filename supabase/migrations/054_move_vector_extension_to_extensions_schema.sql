-- ============================================================
-- MIGRATION 054: Move `vector` extension out of the public schema
--
-- Database advisor finding (extension_in_public): the pgvector extension
-- was installed directly in `public` instead of Supabase's dedicated
-- `extensions` schema. Verified safe before applying:
--   - `extensions` schema already exists and is already in search_path
--     ("$user", public, extensions), so unqualified references keep
--     resolving correctly.
--   - customer_memory_v2 (the only table using the vector type) has 0 rows
--     — no live embeddings data affected.
--   - No explicit `public.vector`-qualified references found anywhere in
--     migrations or application code.
-- ============================================================

BEGIN;

ALTER EXTENSION vector SET SCHEMA extensions;

COMMIT;
