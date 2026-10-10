-- Email verification by 6-digit code: count wrong guesses per code (brute-force lockout). Additive.
ALTER TABLE "OneTimeToken" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
