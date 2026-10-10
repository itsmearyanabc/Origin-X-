-- Supabase hardening for the sales tables added in 20261010000100 (same policy as every other
-- table: RLS on with no policies, and no privileges for the Supabase API roles). Additive only.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['Sale','SaleItem'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
        END IF;
    END LOOP;
END;
$$;
