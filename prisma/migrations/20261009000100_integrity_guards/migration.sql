-- ORIGINX integrity guards (PostgreSQL / Supabase).
-- Enforced in the database itself so no application code path — and no normal user — can rewrite
-- history. Platform admins intervene by appending new records, never by editing old ones.

-- ---------------------------------------------------------------------------
-- Append-only tables: AuditLog, VerificationLog
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION originx_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ORIGINX_APPEND_ONLY: % rows cannot be modified or deleted (%)', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION originx_append_only();
CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog"
    FOR EACH STATEMENT EXECUTE FUNCTION originx_append_only();

CREATE TRIGGER "VerificationLog_append_only" BEFORE UPDATE OR DELETE ON "VerificationLog"
    FOR EACH ROW EXECUTE FUNCTION originx_append_only();
CREATE TRIGGER "VerificationLog_no_truncate" BEFORE TRUNCATE ON "VerificationLog"
    FOR EACH STATEMENT EXECUTE FUNCTION originx_append_only();

-- ---------------------------------------------------------------------------
-- ProductEvent: hashed columns are immutable; only the anchoring bookkeeping columns
-- ("blockchainProofId", "verificationStatus") may change. A row in "DemoTamperUnlock" exists only
-- inside the controlled DEMO_MODE tamper transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION originx_event_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "DemoTamperUnlock") THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ORIGINX_IMMUTABLE: product events cannot be deleted';
    END IF;
    IF ROW(NEW."organizationId", NEW."productId", NEW."sequence", NEW."eventType", NEW."actorUserId",
           NEW."actorOrganizationId", NEW."timestamp", NEW."location", NEW."metadataJson",
           NEW."previousEventHash", NEW."eventHash")
       IS DISTINCT FROM
       ROW(OLD."organizationId", OLD."productId", OLD."sequence", OLD."eventType", OLD."actorUserId",
           OLD."actorOrganizationId", OLD."timestamp", OLD."location", OLD."metadataJson",
           OLD."previousEventHash", OLD."eventHash") THEN
        RAISE EXCEPTION 'ORIGINX_IMMUTABLE: product events cannot be modified';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductEvent_immutable" BEFORE UPDATE OR DELETE ON "ProductEvent"
    FOR EACH ROW EXECUTE FUNCTION originx_event_immutable();

-- ---------------------------------------------------------------------------
-- BlockchainProof: never deleted; immutable once CONFIRMED on-chain.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION originx_proof_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ORIGINX_IMMUTABLE: blockchain proofs cannot be deleted';
    END IF;
    IF OLD."status" = 'CONFIRMED' THEN
        RAISE EXCEPTION 'ORIGINX_IMMUTABLE: confirmed blockchain proofs cannot be modified';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "BlockchainProof_guard" BEFORE UPDATE OR DELETE ON "BlockchainProof"
    FOR EACH ROW EXECUTE FUNCTION originx_proof_guard();

-- ---------------------------------------------------------------------------
-- Supabase hardening.
-- Supabase auto-exposes the public schema through its REST/GraphQL APIs to the "anon" and
-- "authenticated" roles. ORIGINX only talks to Postgres through its own backend, so:
--   1. Row Level Security is enabled on every table with NO policies => API roles see nothing.
--   2. Privileges are revoked from those roles (when they exist; plain Postgres has no such roles).
-- The backend connects as the table owner, which bypasses RLS.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
        EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    END IF;
END;
$$;
