-- Client Owned Data (founder, 19 Nov 2026; Functional Charter "Obsidian vault: Client Owned Data";
-- docs/Wiki-Knowledge.md §0.6). Each user has exactly one knowledge model, chosen when the user is created:
--   'nexeo'    = Nexeo Owned Data: the Nexeo wiki (every existing user).
--   'external' = Client Owned Data: his knowledge is in his own Obsidian vault; Nexeo fetches nothing,
--                stores nothing in its wiki for him and reads nothing from the vault.
-- Hand-written and idempotent; additive only. Read through services/wiki/knowledgeModel.ts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS knowledge_model VARCHAR(20) NOT NULL DEFAULT 'nexeo';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_knowledge_model_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_knowledge_model_check CHECK (knowledge_model IN ('nexeo', 'external'));
  END IF;
END $$;
