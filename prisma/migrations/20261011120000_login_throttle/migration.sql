-- Progressive sign-in lockout (brute-force protection). Additive only.
CREATE TABLE "LoginThrottle" (
    "keyHash" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX "LoginThrottle_lastFailedAt_idx" ON "LoginThrottle"("lastFailedAt");

-- Supabase hardening, same policy as every other table: RLS on with no policies, and no
-- privileges for the Supabase API roles.
ALTER TABLE "LoginThrottle" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON "LoginThrottle" FROM anon, authenticated';
    END IF;
END;
$$;
