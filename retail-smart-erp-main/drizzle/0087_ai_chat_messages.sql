-- AI Chat Messages table for conversation memory
CREATE TABLE IF NOT EXISTS "ai_chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "role" varchar(20) NOT NULL,
  "content" text NOT NULL,
  "tools_used" jsonb,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_ai_chat_messages_tenant" ON "ai_chat_messages" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_ai_chat_messages_user" ON "ai_chat_messages" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_ai_chat_messages_user_created" ON "ai_chat_messages" ("user_id", "created_at" DESC);

-- RLS
ALTER TABLE "ai_chat_messages" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_chat_messages' AND policyname = 'tenant_isolation_policy'
  ) THEN
    CREATE POLICY "tenant_isolation_policy" ON "ai_chat_messages"
      FOR ALL
      USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_chat_messages" TO app_user;
