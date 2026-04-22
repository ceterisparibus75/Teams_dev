# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commandes essentielles

```bash
# Développement
npm run dev          # Lance Next.js en mode dev (port 3000)
npm run bot          # Lance le service bot en arrière-plan (port 3001)

# Build & production
npm run build        # prisma generate + next build
npm start            # Démarre en mode production

# Base de données
npm run db:migrate   # Applique les migrations Prisma
npm run db:generate  # Régénère le client Prisma
npm run db:seed      # Peuple la base avec des données initiales

# Tests
npx jest                          # Tous les tests
npx jest --testPathPattern=<nom>  # Un seul fichier de test
```

## Architecture générale

**Teams Minutes** est une application qui capte les transcriptions des réunions Microsoft Teams, génère automatiquement des comptes-rendus via Claude AI, et permet leur diffusion.

### Flux principal

```
Connexion Azure AD (NextAuth)
    → Session JWT avec tokens Microsoft
    → Dashboard : liste des réunions Teams (Graph API)
    → Génération du compte-rendu (Claude Sonnet via @anthropic-ai/sdk)
    → Édition / révision basée sur un template
    → Export DOCX ou envoi par email
```

### Service bot (indépendant)

`bot/` est un serveur Express séparé (port 3001) qui tourne en parallèle de Next.js. Il surveille en boucle (toutes les 60 s) les réunions Teams terminées, récupère la transcription via Graph API, puis appelle `/api/bot-generate/[meetingId]` pour déclencher la génération. Il est authentifié par `BOT_SECRET`.

### Structure src/

| Dossier | Rôle |
|---|---|
| `src/app/(auth)/` | Page de connexion |
| `src/app/(dashboard)/` | Interface principale protégée |
| `src/app/api/` | Toutes les routes API Next.js |
| `src/lib/` | Services partagés (auth, Graph API, IA, DOCX, email) |
| `src/components/` | Composants React réutilisables |
| `prisma/` | Schéma PostgreSQL et migrations |

### Services clés dans `src/lib/`

- **`auth.ts`** — Configuration NextAuth + Azure AD, gestion du refresh token
- **`microsoft-graph.ts`** — Appels à Microsoft Graph (réunions, transcriptions, calendrier)
- **`azure-openai.ts`** — Génération des comptes-rendus via Claude (deux styles : `detailed` / `concise`)
- **`docx-generator.ts`** — Export Word via la lib `docx`
- **`email-sender.ts`** — Envoi des comptes-rendus par email
- **`prisma.ts`** — Singleton du client Prisma

### Modèles de données (Prisma / PostgreSQL)

- `User` — Utilisateurs connectés (tokens Microsoft stockés)
- `Meeting` — Réunions Teams synchronisées
- `MeetingParticipant` — Participants d'une réunion
- `MeetingCollaborator` — Accès partagé à des comptes-rendus
- `MeetingMinutes` — Compte-rendu généré (statut : DRAFT / REVIEWED / SENT)
- `Template` — Gabarits réutilisables avec sections JSON

### Authentification

NextAuth v4 avec provider Azure AD. La session JWT embarque le `accessToken` Microsoft pour les appels Graph API. Le refresh automatique est géré dans le callback `jwt()` de `src/lib/auth.ts`.

### Variables d'environnement obligatoires

```
DATABASE_URL          # PostgreSQL
NEXTAUTH_URL          # URL publique de l'app
NEXTAUTH_SECRET       # Secret JWT NextAuth
AZURE_AD_CLIENT_ID    # App Azure AD
AZURE_AD_CLIENT_SECRET
AZURE_AD_TENANT_ID
ANTHROPIC_API_KEY     # Claude AI
CRON_SECRET           # Sécurité endpoint cron
BOT_SECRET            # Authentification bot → API
```

### Génération IA

`src/lib/azure-openai.ts` appelle Claude Sonnet via `@anthropic-ai/sdk`. La réponse est un JSON structuré `{ summary, actions[], notes }`. Les prompts sont calibrés pour le domaine juridique/financier de SELAS (procédures d'insolvabilité, conciliation). Toujours en français, pas de données inventées.

### Technologies principales

- **Next.js 16** (App Router, React 19) — lire `node_modules/next/dist/docs/` avant de modifier des conventions
- **Tailwind CSS 4** — syntaxe modifiée par rapport à v3, vérifier la doc
- **Prisma 6** avec PostgreSQL
- **NextAuth 4** + Azure Entra ID
- **@anthropic-ai/sdk** pour Claude
