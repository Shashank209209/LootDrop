CREATE TYPE "account_link_purpose" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION');

ALTER TABLE "users"
ADD COLUMN "password_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "email_verified_at" TIMESTAMPTZ(6);

ALTER TABLE "refresh_tokens"
ADD COLUMN "password_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "account_links" (
    "user_id" UUID NOT NULL,
    "purpose" "account_link_purpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_links_pkey" PRIMARY KEY ("user_id", "purpose")
);

CREATE UNIQUE INDEX "account_links_token_hash_key" ON "account_links"("token_hash");

ALTER TABLE "account_links"
ADD CONSTRAINT "account_links_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
