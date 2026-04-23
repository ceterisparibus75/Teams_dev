# Documentation technique — Teams Minutes

> Application de génération automatique de procès-verbaux pour SELAS BL & Associés.
> Dernière mise à jour de l'audit : 2026-04-23

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Installation et configuration](#2-installation-et-configuration)
3. [Architecture](#3-architecture)
4. [Base de données — Modèles Prisma](#4-base-de-données--modèles-prisma)
5. [Routes API](#5-routes-api)
6. [Services (src/lib/)](#6-services-srclib)
7. [Service bot (bot/)](#7-service-bot-bot)
8. [Composants React](#8-composants-react)
9. [Génération IA — Claude Opus](#9-génération-ia--claude-opus)
10. [Déploiement](#10-déploiement)
11. [Limitations connues et points de vigilance](#11-limitations-connues-et-points-de-vigilance)

---

## 1. Vue d'ensemble

**Teams Minutes** automatise la rédaction de procès-verbaux pour les réunions de procédures judiciaires et amiables.

### Ce que fait l'application

- **Capture** : synchronise les réunions Microsoft Teams depuis le calendrier Outlook de l'utilisateur
- **Transcrit** : récupère la transcription VTT générée par Teams, ou enregistre audio via bot navigateur (Zoom, Google Meet, Teams externe)
- **Génère** : produit un PV structuré via Claude Opus, calibré pour le vocabulaire juridique/financier de BL&Associés
- **Édite** : interface d'édition du PV avant validation
- **Diffuse** : export DOCX avec template personnalisable ou envoi par email

### Utilisateurs cibles

Collaborateurs et administrateurs judiciaires de SELAS BL & Associés, accédant via leur compte Microsoft 365.

---

## 2. Installation et configuration

### Prérequis

- Node.js 20+
- PostgreSQL (ou Supabase)
- Compte Microsoft Azure avec app enregistrée
- Clé API Anthropic (Claude)
- Clé API OpenAI (Whisper — pour bot audio uniquement)

### Installation

```bash
# Dépendances
npm install

# (Optionnel) Chromium pour bot navigateur
npm run bot:install

# Variables d'environnement
cp .env.example .env.local
# Remplir toutes les variables (voir section ci-dessous)

# Base de données
npm run db:migrate   # Crée les tables
npm run db:seed      # Données initiales (template par défaut)

# Développement
npm run dev          # Next.js sur http://localhost:3000
npm run bot          # Bot Express sur http://localhost:3001 (terminal séparé)
```

### Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | URL PostgreSQL avec pooler (ex: Supabase Pooler) |
| `DIRECT_URL` | ✅ | URL PostgreSQL directe (migrations Prisma) |
| `NEXTAUTH_URL` | ✅ | URL publique de l'app (ex: `https://app.example.com`) |
| `NEXTAUTH_SECRET` | ✅ | Secret JWT aléatoire (`openssl rand -base64 32`) |
| `AZURE_AD_CLIENT_ID` | ✅ | ID de l'application Azure AD |
| `AZURE_AD_CLIENT_SECRET` | ✅ | Secret de l'application Azure AD |
| `AZURE_AD_TENANT_ID` | ✅ | ID du tenant Azure AD (BL&Associés) |
| `ANTHROPIC_API_KEY` | ✅ | Clé API Claude (Anthropic) |
| `OPENAI_API_KEY` | ✅ | Clé API OpenAI (Whisper, bot audio uniquement) |
| `CRON_SECRET` | ✅ | Token Bearer pour `/api/cron/poll` |
| `BOT_SECRET` | ✅ | Secret header bot → `/api/bot-generate/` |
| `APP_URL` | Bot uniquement | URL de l'app depuis le service bot |
| `BOT_PORT` | Non | Port Express bot (défaut: `3001`) |
| `BOT_DISPLAY` | Non | Display Xvfb Linux (défaut: `:99`) |
| `BOT_AUDIO_DIR` | Non | Dossier audio temp (défaut: `/tmp/bot-audio`) |

**Variables à NE PAS renseigner** (présentes dans .env.example par erreur, jamais utilisées) :
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`

### Configuration Azure AD requise

L'application Azure AD doit avoir :

**Permissions déléguées (OAuth, consentement utilisateur) :**
- `User.Read`
- `Calendars.Read`
- `Files.Read.All`
- `OnlineMeetings.Read`
- `OnlineMeetingTranscript.Read.All`
- `Mail.Send`

**Permissions applicatives (client credentials, consentement administrateur) :**
- `OnlineMeetings.Read.All`
- `OnlineMeetingTranscript.Read.All`

---

## 3. Architecture

### Vue globale

```
┌─────────────────────────────────────────────────┐
│              Next.js (port 3000)                │
│  ┌────────────┐  ┌──────────────────────────┐  │
│  │  Pages     │  │   Routes API             │  │
│  │ (dashboard │  │  /api/meetings           │  │
│  │  dossiers  │  │  /api/minutes            │  │
│  │  minutes   │  │  /api/generate/[id]      │  │
│  │  prompts)  │  │  /api/bot-generate/[id]  │  │
│  └────────────┘  │  /api/cron/poll          │  │
│                  │  /api/dossiers           │  │
│                  │  /api/prompts            │  │
│                  │  /api/templates          │  │
│                  │  /api/export/[id]        │  │
│                  │  /api/send/[id]          │  │
│                  └──────────────────────────┘  │
└──────────────────────────┬──────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   PostgreSQL       Microsoft Graph      Claude Opus
   (Prisma)         (Azure AD)          (Anthropic)
                           │
              ┌────────────┴──────────┐
              │  Bot Express (3001)   │
              │  ┌──────────────────┐ │
              │  │ watcher.ts       │ │ ← Polling 60s
              │  │ browser-bot.ts   │ │ ← Playwright
              │  │ transcriber.ts   │ │ ← Whisper
              │  └──────────────────┘ │
              └───────────────────────┘
```

### Flux de génération (détail)

```
1. Réunion Teams terminée
        │
        ├── [Mode bot] watcher.ts détecte la fin (10 min après endDateTime)
        │       → Graph API → transcription VTT
        │       → POST /api/bot-generate/[meetingId]  (avec BOT_SECRET)
        │
        └── [Mode manuel] Utilisateur clique "Générer"
                → POST /api/generate/[meetingId]
                → Réponse immédiate (Minutes créées, isGenerating=true)
                → after() : Graph API → transcription → Claude

2. /api/bot-generate/ ou after() dans /api/generate/
        → getTranscription() → VTT parsé en texte
        → generateMinutesContent() → Claude Opus (tool_use)
        → Validation Zod (PvContentSchema)
        → Prisma : update MeetingMinutes.content
        → isGenerating = false
        → GenerationAuditLog créé (tokens, durée, hash)
```

---

## 4. Base de données — Modèles Prisma

### Enums

```
UserRole            ADMIN | ADMINISTRATEUR_JUDICIAIRE | COLLABORATEUR
TypeProcedure       MANDAT_AD_HOC | CONCILIATION | REDRESSEMENT_JUDICIAIRE | SAUVEGARDE
StatutDossier       EN_COURS | CLOS | ARCHIVE
MinutesStatus       DRAFT | VALIDATED | SENT
MeetingPlatform     TEAMS_INTERNAL | TEAMS_EXTERNAL | ZOOM | GOOGLE_MEET | OTHER
BotStatus           SCHEDULED | JOINING | IN_MEETING | PROCESSING | DONE | FAILED
```

### User

| Champ | Type | Description |
|---|---|---|
| `id` | String (cuid) | Identifiant interne |
| `email` | String (unique) | Email Microsoft 365 |
| `name` | String | Nom affiché |
| `role` | UserRole | Rôle dans l'application |
| `microsoftId` | String? (unique) | Object ID Azure AD (claim `oid`) |
| `microsoftAccessToken` | String? | Token d'accès Graph (en clair en BD) |
| `microsoftRefreshToken` | String? | Token de rafraîchissement |
| `microsoftTokenExpiry` | DateTime? | Expiration de l'access token |
| `createdAt` | DateTime | Date de création |

### Dossier

| Champ | Type | Description |
|---|---|---|
| `id` | String (cuid) | Identifiant |
| `reference` | String (unique) | Numéro référence dossier (ex: "2024-MA-001") |
| `denomination` | String | Nom société débitrice |
| `typeProcedure` | TypeProcedure | Type de procédure légale |
| `statut` | StatutDossier | EN_COURS par défaut |
| `createdById` | String | FK → User |

Index : `denomination` (pour auto-association réunions)

### Meeting

| Champ | Type | Description |
|---|---|---|
| `id` | String | **ID Graph API Microsoft** (pas de cuid) |
| `subject` | String | Sujet de la réunion |
| `startDateTime` | DateTime | Début |
| `endDateTime` | DateTime | Fin |
| `organizerId` | String | FK → User (créateur) |
| `joinUrl` | String? | URL Teams pour récupérer la transcription |
| `hasTranscription` | Boolean | Transcription disponible |
| `processedAt` | DateTime? | Date de génération du PV |
| `platform` | MeetingPlatform | TEAMS_INTERNAL par défaut |
| `externalUrl` | String? | URL pour Zoom/Google Meet |
| `botStatus` | BotStatus? | Statut du bot navigateur |
| `botScheduledAt` | DateTime? | Quand le bot a été programmé |
| `dossierId` | String? | FK → Dossier (optionnel) |

Index : `dossierId`, `organizerId`

### MeetingParticipant

| Champ | Type | Description |
|---|---|---|
| `id` | String (cuid) | Identifiant |
| `meetingId` | String | FK → Meeting (cascade delete) |
| `name` | String | Nom complet |
| `email` | String | Email (utilisé pour catégorisation IA) |
| `company` | String? | Société représentée |

### MeetingCollaborator

Clé composite `(meetingId, userId)`. Permet à un utilisateur d'accéder à la réunion d'un collègue.

### MeetingMinutes

| Champ | Type | Description |
|---|---|---|
| `id` | String (cuid) | Identifiant |
| `meetingId` | String (unique) | FK → Meeting (1-1) |
| `authorId` | String | FK → User (créateur) |
| `templateId` | String? | FK → Template |
| `promptId` | String? | FK → Prompt (utilisé pour génération) |
| `status` | MinutesStatus | DRAFT → VALIDATED → SENT |
| `isGenerating` | Boolean | `true` pendant la génération Claude |
| `content` | Json | Contenu structuré PV (type `MinutesContent`) |
| `sentAt` | DateTime? | Date d'envoi email |
| `validatedById` | String? | FK → User (validateur) |
| `validatedAt` | DateTime? | Date de validation |

**Structure `content` (MinutesContent) :**
```typescript
{
  summary: string          // Résumé exécutif
  sections: PVSection[]   // Sections thématiques numérotées
  actions: Action[]        // Points d'action (libellé, responsable, échéance)
  notes: string            // Notes complémentaires
  // Champs PV complets :
  metadata: { date_reunion, affaire, type_procedure, objet, signataire, ville_signature }
  modalites: string
  participants: PVParticipant[]
  documents_amont: string[]
  points_desaccord: string[]
  prochaine_reunion?: { date, heure, fuseau }
  points_vigilance: string[]
  precisions_a_apporter: string[]
}
```

### Template

Gabarit de mise en forme DOCX. Paramètres :

| Catégorie | Champs |
|---|---|
| État | `isDefault`, `isActive` |
| Logo | `logoBase64` (@db.Text), `logoLargeurCm` |
| En-tête | `enteteTexteLignes[]`, `enteteAlignement` |
| Pied de page | `piedPageLignes[]`, `piedPageAlignement`, `numeroterPages`, `formatNumerotation` |
| Polices | `policeCorps`, `taillePoliceCorps`, `policeTitres`, `taillePoliceTitre1`, `taillePoliceTitre2` |
| Couleurs (hex) | `couleurTitres`, `couleurCorps`, `couleurEnteteCabinet`, `couleurEnteteTableau`, `couleurBordureTableau` |
| Marges (cm) | `margeHautCm`, `margeBasCm`, `margeGaucheCm`, `margeDroiteCm` |
| Mise en page | `interligne`, `justifierCorps` |

### Prompt

| Champ | Type | Description |
|---|---|---|
| `nom` | String | Nom du prompt |
| `typeDocument` | String | `"pv_reunion"` par défaut |
| `contenu` | String (@db.Text) | Texte du prompt complet |
| `version` | Int | Numéro de version (incrémenté manuellement) |
| `isActive` | Boolean | Visible dans l'interface |
| `modeleClaude` | String | Modèle Claude (`claude-opus-4-7` par défaut) |
| `createdById` | String | FK → User |

### GenerationAuditLog

Trace chaque appel Claude.

| Champ | Description |
|---|---|
| `minutesId` | FK optionnel → MeetingMinutes |
| `userId` | Utilisateur ayant déclenché |
| `modele` | Modèle Claude utilisé |
| `tokensInput` / `tokensOutput` | Tokens consommés |
| `transcriptHash` | SHA256 de la transcription (pour détecter doublons) |
| `durationMs` | Durée de l'appel en millisecondes |
| `status` | `"success"` ou `"error"` |
| `errorMessage` | Détail si erreur |

---

## 5. Routes API

### Authentification

Toutes les routes utilisateur utilisent `getServerSession(authOptions)`. Si la session est absente ou invalide, retour `401`.

```typescript
const session = await getServerSession(authOptions)
if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
```

Bot secret : header `x-bot-secret` comparé à `process.env.BOT_SECRET`.
Cron secret : header `Authorization: Bearer <CRON_SECRET>`.

### GET /api/meetings

Synchronise les réunions depuis Graph API et retourne la liste.

**Paramètre optionnel :** `?unlinked=1` → retourne seulement les réunions sans dossier associé.

**Comportement :**
1. Récupère les 50 dernières réunions depuis Graph (`getRecentMeetings`)
2. Upsert chaque réunion en BD (évite les doublons)
3. Auto-association dossier si le sujet contient la dénomination du dossier
4. Retourne la liste avec participants et minutes

### POST /api/generate/[meetingId]

Déclenche la génération du PV pour une réunion.

**Réponse immédiate :** crée les `MeetingMinutes` avec `isGenerating: true`, retourne l'ID.

**En arrière-plan (`after()`) :**
1. Récupère la transcription Teams (Graph API)
2. Appelle Claude Opus via `generateMinutesContent()`
3. Sauvegarde le contenu, met `isGenerating: false`

### POST /api/generate/[meetingId]/retranscribe

Body: `{ promptId?: string }` — Régénère le PV avec un prompt personnalisé.

### POST /api/bot-generate/[meetingId]

Auth : header `x-bot-secret`.
Body : `{ transcript: string | null }`.

Appelé par le service bot. Si `transcript` fourni, l'utilise directement. Sinon, tente de récupérer la transcription Teams.

### GET /api/export/[minutesId]

Génère et retourne le fichier DOCX du compte-rendu.

Headers de réponse :
- `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `Content-Disposition: attachment; filename="CR_SUJET_DATE.docx"`

### POST /api/send/[minutesId]

Body : `{ recipients: [{ name: string, email: string }] }`.

1. Génère le DOCX
2. Envoie via Graph API `/me/sendMail` avec pièce jointe
3. Met à jour `minutes.status = SENT` et `minutes.sentAt`

### GET /api/cron/poll

Auth : Bearer token `CRON_SECRET`. À appeler toutes les 2h (Vercel Cron ou externe).

1. Récupère les réunions terminées dans les 2 dernières heures
2. Pour chaque réunion sans PV : récupère transcription + génère

### GET /api/dossiers

Retourne tous les dossiers avec compteurs (`_count.meetings`, `_count.minutes`).

### POST /api/dossiers

Body : `{ reference: string, denomination: string, typeProcedure: TypeProcedure }`.

Crée le dossier et auto-associe les réunions existantes dont le sujet contient la dénomination.

### GET/POST /api/prompts

GET : liste les prompts actifs avec compteur d'utilisation.
POST : crée un nouveau prompt.

Body POST : `{ nom, typeDocument, contenu, modeleClaude, isActive }`.

### POST /api/prompts/test

Body : `{ contenu: string, sujet: string, transcription?: string }`.

Teste un prompt directement contre Claude sans sauvegarder le résultat.

---

## 6. Services (src/lib/)

### auth.ts — NextAuth + Azure AD

**`authOptions`** : configuration NextAuth avec provider Azure AD.

Callback `jwt()` :
1. Premier login : upsert User en BD depuis claims Azure AD (`oid`, `email`, `name`)
2. Stocke `accessToken`, `refreshToken`, `tokenExpiry` dans User
3. Refresh automatique si token expiré (appel MSAL)

Callback `session()` :
- Récupère User en BD
- Enrichit la session avec `id`, `role`, `microsoftId`

### microsoft-graph.ts — Microsoft Graph API

**`getAppOnlyToken()`** : token MSAL client credentials (application, sans utilisateur). Utilisé pour accéder aux transcriptions.

**`getValidAccessToken(userId)`** : récupère token délégué de l'utilisateur depuis BD. Rafraîchit automatiquement si expiré.

**`getRecentMeetings(userId)`** : 50 dernières réunions depuis `/me/calendarView`.

**`getMeetingsEndedInLastHours(userId, hours)`** : réunions terminées dans la fenêtre de temps.

**`getTranscription(userId, joinUrl, options?)`** : 
- Tente récupération transcription VTT via token app-only
- Parse le VTT pour retourner le texte brut (sans timecodes)
- Retourne `TranscriptionResult` (ok/error avec reason précise)
- Reasons possibles : `missing_join_url`, `missing_connection`, `reauth_required`, `permission_denied`, `policy_denied`, `meeting_not_found`, `transcript_not_found`, `transcript_empty`, `graph_error`

### azure-openai.ts — Génération Claude

**`generateMinutesContent(subject, transcription, participants?, options?)`**

Options :
- `userId` — pour audit log
- `minutesId` — pour lier l'audit log
- `promptText` — prompt personnalisé (défaut: SYSTEM_PROMPT intégré)
- `modelName` — modèle Claude (défaut: `claude-opus-4-7`)
- `meetingDate` — date pour contexte

Processus interne :
1. Tronque transcription à 60 000 chars (50k début + 10k fin) si nécessaire
2. Appel Claude avec `tool_use`, outil `generer_pv`, `max_tokens: 16000`
3. Extrait `input` du bloc `tool_use`
4. Valide avec `PvContentSchema` (Zod) — validation lenient si partielle
5. Mappe `PvContent` → `MinutesContent`
6. Sauvegarde `GenerationAuditLog` (tokens, durée, hash SHA256)
7. Retry 1x si réponse vide

**SYSTEM_PROMPT** intégré (non modifiable sans code) :
- Domaine d'expertise : procédures amiables (mandat ad hoc, conciliation), collectives (sauvegarde, redressement), finance en difficulté
- Modèle de style PV à respecter
- Règles strictes : attribution systématique, listes tiretées `;`/`.`, longueur substantielle (3-5 pages/heure)
- Règle catégorisation BL&Associés : email `@bl-aj.fr` → rôle selon type procédure

**Prompt personnalisé** : si `promptText` fourni, remplace SYSTEM_PROMPT. Accessible via l'interface Prompts.

### docx-generator.ts — Export Word

**`generateDocx(options)`**

Options : `subject`, `date`, `participants`, `content: MinutesContent`, `sections: TemplateSection[]`, `template?: Template`.

Structure du document généré :
1. En-tête : logo (si fourni) + lignes de texte cabinet
2. Titre réunion
3. Tableau métadonnées (date, affaire, type procédure, signataire, ville)
4. Modalités (Visioconférence, Présentiel…)
5. Tableau participants regroupés par catégorie
6. Résumé exécutif
7. Sections thématiques numérotées (contenu Markdown-like converti)
8. Tableau des points d'action
9. Notes complémentaires
10. Pied de page (numérotation `Page {n} sur {total}`)

Personnalisation complète via Template : polices, couleurs hex, marges cm, logo base64, en-tête/pied multiligne.

### email-sender.ts — Envoi email

**`sendMinutesEmail(params)`**

Paramètres : `userId`, `subject`, `recipients[]`, `content`, `docxBuffer`, `docxFilename`.

1. Récupère token Microsoft de l'utilisateur
2. Construit HTML body (résumé + tableau actions)
3. POST `/me/sendMail` avec pièce jointe base64
4. L'email apparaît dans les Éléments envoyés de l'utilisateur

### openai-transcription.ts — Whisper

**`transcribeMedia({ buffer, filename, contentType })`**

- Limite : 25 MB
- Modèle : `whisper-1`, langue : `fr`
- Retourne texte brut

Utilisé uniquement par le bot navigateur pour les réunions externes.

---

## 7. Service bot (bot/)

### Rôle

Service Express indépendant (port 3001) qui automatise la collecte de transcriptions sans intervention humaine.

### bot/index.ts — Serveur Express

```
GET /health  →  { status: "ok", timestamp }
```

Fonction `triggerGeneration(meetingDbId, transcript)` :
1. Met à jour Meeting en BD (`hasTranscription`, `processedAt`)
2. POST `/api/bot-generate/[meetingId]` avec header `x-bot-secret`

Démarre `startWatcher()` au lancement.

### bot/watcher.ts — Surveillance

**Cycle toutes les 60 secondes :**

1. **`syncCalendarMeetings()`** : récupère réunions Outlook, crée/update Meeting en BD, détecte la plateforme (Teams, Zoom, Google Meet)
2. **`processEndedMeetings()`** : 10 min après `endDateTime`, récupère transcription VTT Teams, appelle `triggerGeneration()`
3. **`scheduleAndRunBots()`** : 3 min avant `startDateTime` des réunions externes, programme le bot navigateur

### bot/browser-bot.ts — Bot Playwright

Prérequis serveur Linux :
- Chromium (via `npm run bot:install`)
- Xvfb (display virtuel)
- PulseAudio (capture audio)
- ffmpeg (enregistrement WAV 16 kHz mono)

**`joinMeeting(target)`** :
1. Lance Chromium headless sur display Xvfb
2. Démarre enregistrement ffmpeg
3. Navigue vers l'URL de réunion
4. Remplit pseudo "Assistant BL&Associés", accepte permissions
5. Surveille l'événement "Meeting ended"
6. Arrête ffmpeg, appelle `transcribeAudio()` → Whisper
7. Appelle `triggerGeneration()`

### bot/transcriber.ts — Transcription Whisper

**`transcribeAudio(audioFilePath)`** : lit WAV depuis disque, envoie à OpenAI Whisper, retourne texte.

---

## 8. Composants React

### Pages

| Page | Route | Description |
|---|---|---|
| Dashboard | `/` | Liste réunions, polling 15s si génération en cours |
| Réunions | `/reunions` | Sync manuelle, liste avec filtres |
| Comptes-rendus | `/comptes-rendus` | Liste minutes, filtrage, recherche |
| Détail minute | `/comptes-rendus/[id]` | Édition complète du PV |
| Dossiers | `/dossiers` | Liste dossiers avec compteurs |
| Nouveau dossier | `/dossiers/nouveau` | Formulaire création |
| Détail dossier | `/dossiers/[id]` | Détail + réunions associées |
| Prompts | `/prompts` | Gestion prompts Claude (CRUD) |
| Paramètres | `/parametres` | Paramètres utilisateur |

### Composants principaux

| Composant | Fichier | Description |
|---|---|---|
| `Sidebar` | `components/layout/sidebar.tsx` | Navigation principale + déconnexion |
| `MeetingCard` | `components/meetings/MeetingCard.tsx` | Carte réunion + bouton génération |
| `SectionEditor` | `components/minutes/SectionEditor.tsx` | Éditeur sections PV |
| `SendModal` | `components/minutes/SendModal.tsx` | Modal envoi email + destinataires |
| `PromptEditor` | `components/prompts/PromptEditor.tsx` | Éditeur prompt Claude |
| `TemplateEditor` | `components/templates/TemplateEditor.tsx` | Éditeur template DOCX |

### Composants UI

Basés sur shadcn/ui avec Tailwind CSS 4 :
- `badge.tsx` — Statut DRAFT / VALIDATED / SENT
- `button.tsx` — Boutons primaire, secondaire, danger
- `card.tsx` — Conteneurs
- `modal.tsx` — Fenêtres modales

---

## 9. Génération IA — Claude Opus

### Modèle

`claude-opus-4-7` via `@anthropic-ai/sdk ^0.90.0`.

Pattern utilisé : **tool_use** avec l'outil `generer_pv`. Cela force Claude à retourner un JSON structuré plutôt que du texte libre.

### Structure de l'outil `generer_pv`

```
metadata         : { date_reunion, affaire, type_procedure, objet, signataire, ville_signature }
modalites        : string (ex: "Visioconférence")
participants     : [{ civilite_nom, societe_qualite, email, presence, categorie }]
documents_amont  : string[]
resume           : string (résumé exécutif)
sections         : [{ titre, contenu }] — 4 à 8 sections thématiques
points_desaccord : string[]
actions          : [{ libelle, responsable, echeance }]
prochaine_reunion: { date, heure, fuseau } — optionnel
points_vigilance : string[]
precisions_a_apporter: string[]
```

### Catégories de participants

```
debiteur | conseil_debiteur | partenaire_bancaire | conseil_partenaire |
auditeur_expert | mandataire_ad_hoc | conciliateur | administrateur_judiciaire |
mandataire_judiciaire | actionnaire | repreneur | autre
```

**Règle BL&Associés** : si email contient `@bl-aj.fr` → catégorie automatique selon type procédure :
- Mandat ad hoc → `mandataire_ad_hoc`
- Conciliation → `conciliateur`
- Redressement/Sauvegarde → `administrateur_judiciaire`

### Prompt personnalisé

L'utilisateur peut créer des prompts via `/prompts`. Le prompt personnalisé **remplace entièrement** le `SYSTEM_PROMPT` par défaut. Il peut référencer `{sujet}` et `{transcription}` dans le texte.

Test de prompt disponible via `/api/prompts/test` sans sauvegarder.

### Coûts et consommation

Chaque génération crée un `GenerationAuditLog` avec les tokens consommés. Consulter la table pour estimer les coûts.

Limite transcription : 60 000 caractères (50k début + 10k fin). Au-delà, le milieu est perdu.

---

## 10. Déploiement

### Sur Vercel

```bash
# Déployer Next.js
vercel deploy

# Variables d'environnement
vercel env add DATABASE_URL
vercel env add DIRECT_URL
# ... (toutes les variables obligatoires)
```

`vercel.json` configure le cron :
```json
{
  "crons": [{ "path": "/api/cron/poll", "schedule": "0 */2 * * *" }]
}
```

### Service bot (serveur Linux séparé)

Le bot Playwright **ne peut pas tourner sur Vercel** (serverless). Il nécessite un serveur persistant Linux avec :
- Xvfb + PulseAudio + ffmpeg installés
- Chromium : `npm run bot:install`
- Processus persistant (pm2, systemd, Docker)

```bash
# Exemple avec pm2
pm2 start "npm run bot" --name teams-bot
pm2 save
pm2 startup
```

### PostgreSQL

Recommandé : Supabase ou Neon.
- `DATABASE_URL` : URL avec pooler (pour Next.js serverless)
- `DIRECT_URL` : URL directe (pour `prisma migrate deploy`)

```bash
# En production
npx prisma migrate deploy
```

---

## 11. Limitations connues et points de vigilance

### Génération IA

- **Transcription tronquée** : si > 60 000 caractères, le milieu de la transcription est perdu. Réunions longues (> 3h) peuvent produire un PV incomplet.
- **isGenerating bloqué** : si le serveur crash pendant `after()`, le flag reste à `true`. Corriger manuellement via BD.
- **Retry limité** : 1 seul retry si Claude retourne vide. Pas de backoff exponentiel.

### Sécurité

- **Tokens Microsoft en clair** : `microsoftAccessToken` et `microsoftRefreshToken` stockés en clair en PostgreSQL. La sécurité repose sur la sécurité de la BD.
- **BOT_SECRET** : pas de rate limiting sur `/api/bot-generate/`. Secret à rotation régulière.
- **CRON_SECRET** : pas de vérification HMAC/timestamp, vulnérable aux replay attacks.
- **Catégorisation email** : basée sur `@bl-aj.fr` dans l'email, pas sur une vérification Active Directory.

### Performance

- **Logo template base64** : stocké en `@db.Text` sans limite de taille. Logo > 2 MB peut ralentir les requêtes.
- **Pagination** : `/api/minutes` sans limite peut retourner des centaines de documents.
- **N+1 potentiel** : certaines routes dossiers itèrent sans include Prisma optimisé.

### Traçabilité

- **Pas d'historique des modifications** : les éditions de PV ne sont pas versionnées. Impossible de voir qui a modifié quoi.
- **GenerationAuditLog** existe mais pas de `MinutesEditLog`.

### Bot navigateur

- **Linux uniquement** : Playwright + Xvfb nécessite Linux. Incompatible Windows/Mac en production.
- **Dépendance UI externe** : le bot Playwright est fragile aux changements d'interface de Zoom/Teams/Google Meet.
- **Audio local** : les fichiers WAV temporaires doivent être supprimés manuellement en cas d'échec.

### Maintenance

- **Template par défaut** : pas de contrainte unique en BD — possible d'avoir plusieurs templates `isDefault: true` si bug.
- **Variables .env.example obsolètes** : `AZURE_OPENAI_*` présentes mais jamais utilisées dans le code.
