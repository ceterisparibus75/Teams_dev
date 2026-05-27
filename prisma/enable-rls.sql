-- Active Row Level Security sur toutes les tables publiques.
--
-- Contexte : Supabase Security Advisor signale RLS désactivé sur toutes les
-- tables car elles sont exposées via PostgREST (anon / authenticated keys).
-- Cette app n'utilise pas Supabase Auth — Prisma se connecte avec le rôle
-- `postgres` qui a BYPASSRLS, donc activer RLS sans policies bloque l'API
-- publique tout en laissant Prisma fonctionner normalement.
--
-- À exécuter dans Supabase Dashboard → SQL Editor (rôle postgres).

ALTER TABLE public."_prisma_migrations"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Dossier"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Meeting"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MeetingParticipant"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MeetingCollaborator"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MeetingMinutes"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Template"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Prompt"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."GenerationAuditLog"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MinutesEditLog"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CronRun"               ENABLE ROW LEVEL SECURITY;

-- Vérification : toutes doivent retourner rowsecurity = true
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
