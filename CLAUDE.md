# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commandes essentielles

```bash
# Développement
npm run dev          # Lance Next.js en mode dev (port 3000)
npm run bot          # Lance le service bot (port 3001, nécessite ts-node)

# Build & production
npm run build        # prisma generate + next build
npm start            # Démarre en mode production

# Base de données
npm run db:migrate   # Applique les migrations Prisma (crée les tables)
npm run db:generate  # Régénère le client Prisma après modif schema.prisma
npm run db:seed      # Peuple la base avec données initiales

# Tests
npx jest                          # Tous les tests (__tests__/)
npx jest --testPathPattern=<nom>  # Un seul fichier de test

# Bot navigateur (réunions externes)
npm run bot:install  # Installe Chromium pour Playwright (une seule fois)
```

## Architecture générale

**Teams Minutes** est une application qui capte les transcriptions des réunions Microsoft Teams (et Zoom/Google Meet via bot navigateur), génère automatiquement des procès-verbaux via Claude AI, et permet leur diffusion par email ou export DOCX.

### Flux principal

```
Connexion Azure AD (NextAuth v4)
    → Session JWT avec tokens Microsoft (accessToken + refreshToken)
    → Dashboard : liste des réunions Teams (Graph API)
    → Génération du PV (Claude Opus via @anthropic-ai/sdk + tool_use)
    → Édition avec template personnalisable
    → Export DOCX ou envoi par email (Graph API /me/sendMail)
```

### Deux modes de génération

1. **Manuel** — Utilisateur clique "Générer" → `/api/generate/[meetingId]` → réponse immédiate (squelette) + `after()` pour Claude en arrière-plan
2. **Automatique (bot)** — Service Express surveille le calendrier Outlook toutes les 60s → détecte réunions terminées → récupère transcription VTT → POST `/api/bot-generate/[meetingId]`

### Service bot (indépendant)

`bot/` est un serveur Express séparé (port 3001) qui tourne en parallèle de Next.js.

- **Réunions Teams internes** : surveille Outlook, récupère transcription VTT via Graph API
- **Réunions externes** (Teams externe, Zoom, Google Meet) : lance un bot navigateur Playwright 3 min avant le début, capture audio, transcrit via OpenAI Whisper
- Authentifié par header `x-bot-secret` = `BOT_SECRET`

### Structure src/

| Dossier | Rôle |
|---|---|
| `src/app/(auth)/signin/` | Page de connexion Azure AD |
| `src/app/(dashboard)/` | Interface principale protégée (dashboard, réunions, comptes-rendus, dossiers, prompts, paramètres) |
| `src/app/api/` | Toutes les routes API Next.js |
| `src/lib/` | Services partagés |
| `src/components/` | Composants React (meetings, minutes, prompts, templates, ui) |
| `src/schemas/` | Schémas Zod de validation (`pv-content.schema.ts`) |
| `src/types/` | Types TypeScript partagés (`index.ts`) |
| `prisma/` | Schéma PostgreSQL et migrations |
| `bot/` | Service Express indépendant |
| `__tests__/` | Tests unitaires (jest + ts-jest) |

### Services clés dans `src/lib/`

- **`auth.ts`** — Configuration NextAuth + Azure AD ; callbacks `jwt()` (upsert user, stocke tokens) et `session()` (enrichit session) ; refresh token automatique
- **`microsoft-graph.ts`** — Token app-only (client credentials MSAL), token délégué (refresh), récupération réunions Outlook, transcription VTT Teams, envoi email Graph
- **`azure-openai.ts`** — Génération PV via Claude Opus (`claude-opus-4-7`) avec `tool_use` ("generer_pv") ; prompts calibrés procédures judiciaires BL&Associés ; validation Zod ; audit log en BD
- **`docx-generator.ts`** — Export Word avec lib `docx` ; personnalisation via Template (logo base64, polices, couleurs, marges)
- **`email-sender.ts`** — Envoi email avec pièce jointe DOCX via `/me/sendMail` Graph API
- **`openai-transcription.ts`** — Transcription audio via OpenAI Whisper (whisper-1, fr, max 25 MB)
- **`microsoft-scopes.ts`** — Constante des scopes OAuth Graph requis
- **`prisma.ts`** — Singleton client Prisma (évite reconnexion en hot-reload)
- **`utils.ts`** — `cn()` (Tailwind merge), `formatDate()`, `formatDateTime()`, `slugify()`

### Routes API complètes

| Route | Méthodes | Auth | Rôle |
|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | — | NextAuth (Azure AD) |
| `/api/meetings` | GET | JWT | Sync + liste réunions Teams |
| `/api/minutes` | GET | JWT | Liste tous comptes-rendus accessibles |
| `/api/minutes/[id]` | GET, PUT, PATCH, DELETE | JWT | CRUD compte-rendu |
| `/api/generate/[meetingId]` | POST | JWT | Génère PV (immédiat + after) |
| `/api/generate/[meetingId]/retranscribe` | POST | JWT | Régénère avec prompt choisi |
| `/api/bot-generate/[meetingId]` | POST | BOT_SECRET | Route appelée par le bot |
| `/api/export/[minutesId]` | GET | JWT | Télécharge DOCX |
| `/api/send/[minutesId]` | POST | JWT | Envoie email + DOCX |
| `/api/cron/poll` | GET | CRON_SECRET | Polling réunions terminées (toutes 2h) |
| `/api/dossiers` | GET, POST | JWT | Liste + création dossiers juridiques |
| `/api/dossiers/[id]` | GET, PUT, DELETE | JWT | CRUD dossier |
| `/api/dossiers/[id]/meetings` | GET | JWT | Réunions d'un dossier |
| `/api/prompts` | GET, POST | JWT | Liste + création prompts Claude |
| `/api/prompts/[id]` | GET, PUT, DELETE | JWT | CRUD prompt |
| `/api/prompts/test` | POST | JWT | Test prompt sans sauvegarde |
| `/api/templates` | GET, POST | JWT | Liste + création templates DOCX |
| `/api/templates/[id]` | GET, PUT, DELETE | JWT | CRUD template |

**Authentification :**
- Routes utilisateur : `getServerSession(authOptions)` → `401` si absent
- Bot : header `x-bot-secret === process.env.BOT_SECRET`
- Cron : header `Authorization: Bearer ${CRON_SECRET}`

### Modèles de données (Prisma / PostgreSQL)

**Enums :**
- `UserRole` : ADMIN | ADMINISTRATEUR_JUDICIAIRE | COLLABORATEUR
- `TypeProcedure` : MANDAT_AD_HOC | CONCILIATION | REDRESSEMENT_JUDICIAIRE | SAUVEGARDE
- `StatutDossier` : EN_COURS | CLOS | ARCHIVE
- `MinutesStatus` : DRAFT | VALIDATED | SENT
- `MeetingPlatform` : TEAMS_INTERNAL | TEAMS_EXTERNAL | ZOOM | GOOGLE_MEET | OTHER
- `BotStatus` : SCHEDULED | JOINING | IN_MEETING | PROCESSING | DONE | FAILED

**Modèles :**
- `User` — Utilisateurs (email, role, tokens Microsoft chiffrés en transit)
- `Dossier` — Dossiers juridiques (référence unique, dénomination, typeProcedure)
- `Meeting` — Réunions Teams synchronisées (id = Graph API ID, platform, botStatus)
- `MeetingParticipant` — Participants (name, email, company)
- `MeetingCollaborator` — Accès partagé (clé composite meetingId+userId)
- `MeetingMinutes` — PV généré (content: Json, status: DRAFT/VALIDATED/SENT, isGenerating)
- `Template` — Gabarits DOCX (logo base64 @db.Text, polices, couleurs hex, marges cm)
- `Prompt` — Prompts Claude personnalisés (contenu, modeleClaude, typeDocument)
- `GenerationAuditLog` — Audit des appels Claude (tokens, durée, hash transcription)

### Authentification

NextAuth v4 avec provider Azure AD (Entra ID). La session JWT embarque les tokens Microsoft. Le refresh automatique est dans le callback `jwt()` de `src/lib/auth.ts`. Les scopes Graph requis : `User.Read, Calendars.Read, Files.Read.All, OnlineMeetings.Read, OnlineMeetingTranscript.Read.All, Mail.Send`.

### Variables d'environnement obligatoires

```
# Base de données
DATABASE_URL          # PostgreSQL (connection pooler, ex: Supabase pooler)
DIRECT_URL            # PostgreSQL connexion directe (pour migrations Prisma)

# NextAuth
NEXTAUTH_URL          # URL publique de l'app (ex: https://teams-minutes.vercel.app)
NEXTAUTH_SECRET       # Secret JWT (openssl rand -base64 32)

# Azure AD (Entra ID)
AZURE_AD_CLIENT_ID    # ID application Azure AD
AZURE_AD_CLIENT_SECRET
AZURE_AD_TENANT_ID

# IA
ANTHROPIC_API_KEY     # Claude Opus (génération PV)
OPENAI_API_KEY        # Whisper (transcription audio bot)

# Sécurité endpoints
CRON_SECRET           # Token Bearer pour /api/cron/poll
BOT_SECRET            # Secret header bot → /api/bot-generate/

# Bot navigateur (si déployé)
APP_URL               # URL callback API depuis bot (ex: http://localhost:3000)
BOT_PORT              # Port Express bot (défaut: 3001)
BOT_DISPLAY           # Display Xvfb (défaut: :99, Linux seulement)
BOT_AUDIO_DIR         # Dossier audio temporaire (défaut: /tmp/bot-audio)
```

**ATTENTION** : `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` sont dans `.env.example` mais **jamais utilisés** dans le code — l'app utilise Claude via `@anthropic-ai/sdk` (pas Azure OpenAI).

### Génération IA

`src/lib/azure-openai.ts` appelle **Claude Opus** (`claude-opus-4-7`) via `@anthropic-ai/sdk` avec le pattern `tool_use` (outil `generer_pv`). La réponse est validée avec Zod (`PvContentSchema`). Les prompts intègrent le domaine juridique BL&Associés (procédures amiables, collectives, finance en difficulté). Toujours en français, aucune donnée inventée.

**Limites :**
- Transcription tronquée si > 60 000 caractères (50k début + 10k fin)
- Modèle par défaut configurable par prompt personnalisé
- Retry 1x si réponse vide

### Technologies principales

- **Next.js 16.2.4** (App Router, React 19) — lire `node_modules/next/dist/docs/` avant de modifier des conventions
- **Tailwind CSS 4** — syntaxe différente de v3, vérifier la doc
- **Prisma 6.19.3** avec PostgreSQL
- **NextAuth 4.24.14** + Azure Entra ID
- **@anthropic-ai/sdk ^0.90.0** pour Claude Opus
- **openai ^6.34.0** pour Whisper (transcription bot uniquement)
- **docx ^9.6.1** pour génération DOCX
- **playwright-core ^1.50.0** pour bot navigateur (Chromium)
- **express ^5.2.1** pour le service bot
- **zod ^4.3.6** pour validation schémas
- **sonner ^2.0.7** pour notifications toast

### Points d'attention pour les modifications

1. **Schéma PV** — Toute modification du schéma Zod dans `src/schemas/pv-content.schema.ts` doit être cohérente avec l'outil Claude dans `src/lib/azure-openai.ts`
2. **Tokens Microsoft** — `microsoft-graph.ts` gère deux types de tokens : app-only (client credentials, pour transcriptions) et délégué (pour calendrier/email utilisateur)
3. **isGenerating** — Le flag `MeetingMinutes.isGenerating` est mis à `false` dans le `after()` — si le serveur crash pendant la génération, il reste bloqué à `true`
4. **Template logo** — Stocké en base64 dans PostgreSQL (`@db.Text`) ; pas de limite de taille imposée — éviter > 2 MB
5. **Catégorisation BL&Associés** — Détection par domaine email `@bl-aj.fr` uniquement (règle stricte dans le prompt système)
