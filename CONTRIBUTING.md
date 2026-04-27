# Contribuer à teams-minutes

Bienvenue. Ce document décrit le strict nécessaire pour contribuer au projet sans casser la prod.

## Setup local

```bash
git clone <repo>
npm install
cp .env.example .env       # remplir les vraies valeurs
npm run db:push            # synchronise le schéma sur la BD ciblée
npm run dev                # Next.js sur :3000

# Dans un terminal séparé : dashboard Inngest pour observer les jobs
npx inngest-cli@latest dev
```

Pour le service bot (réunions externes / Zoom / Meet) :

```bash
npm run bot:install        # installe Chromium (une fois)
npm run bot                # service Express sur :3001
```

## Avant de committer

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm test             # jest --ci
npm run build        # next build (smoke)
```

La CI rejettera tout PR qui ne passe pas ces 4 commandes. Le hook pre-commit n'est pas configuré (volontairement), à toi de les lancer.

## Conventions de code

- **Validation** : tout body POST/PATCH/PUT passe par un schéma Zod en début de handler. Pas de `as` cast pour parser la requête.
- **Logger** : utiliser `logger.child({ module: '...' })` au lieu de `console.*`. Le logger redacte automatiquement les champs sensibles (OID, TID, emails, tokens).
- **Auth gates** : `getServerSession(authOptions)` puis `if (!session?.user?.id) return 401`. Le bot et le cron utilisent `safeEqual()` / `safeBearerEqual()` (timing-safe).
- **Génération PV** : passe par Inngest (`inngest.send({ name: 'pv/generate.requested', ... })`). Ne jamais appeler `generateMinutesContent()` en synchrone dans une route utilisateur.
- **Rate limit** : ajouter `rateLimit({ name, key: userId, limit, windowMs })` sur toute route qui déclenche du Claude / du sendMail / un job lourd.

## Architecture en bref

- **Next.js 16 App Router** — frontend + API routes
- **NextAuth + Azure AD** — auth, tokens stockés chiffrés AES-256-GCM
- **Prisma + PostgreSQL** — ORM, schéma pur (pas de migrations folder, on utilise `db push`)
- **Inngest** — job queue durable pour la génération PV (retry, idempotency, observabilité)
- **Claude Opus** via `@anthropic-ai/sdk` — génération du PV avec `tool_use`
- **pino** — logger structuré avec redaction
- **Bot Express** — service séparé Playwright pour réunions externes (Teams ext, Zoom, Meet)

Voir `CLAUDE.md` pour le détail.

## Tests

- `__tests__/lib/` — tests unitaires des libs
- `__tests__/api/` — smoke tests des routes (auth gates, Zod, rate limit, autorisation)
- `__tests__/inngest/` — sanity sur les fonctions Inngest

`maxWorkers: 1` dans `jest.config.ts` pour éviter les flakes sur ts-jest. Privilégier des mocks Prisma + `next-auth` plutôt qu'une vraie BD.

## Variables d'environnement

Voir `.env.example`. En prod (Vercel) :
- Toutes les vars `AZURE_AD_*`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `BOT_SECRET`, `CRON_SECRET`, `NEXTAUTH_SECRET` doivent être renseignées.
- `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` à récupérer sur app.inngest.com (intégration Vercel automatise).
- `SENTRY_DSN` (optionnel) pour activer l'envoi automatique des erreurs.

## Endpoints utiles

- `GET /api/health` — ping BD pour monitoring externe (200 ou 503)
- `GET /api/version` — SHA + branche + region pour diagnostic
- `GET /api/operations` — vue consolidée des traitements (transcriptions / Claude / échecs)
- Dashboard Inngest local : http://localhost:8288

## Déploiement

```bash
# Vérifie que la branche est propre
git status

# Push sur main : Vercel build automatique + déploie
git push

# Vérifie le déploiement
curl https://<prod-url>/api/version
curl https://<prod-url>/api/health
```

Si Inngest n'est pas configuré côté Vercel, les générations resteront bloquées (event envoyé mais jamais traité). Sync l'app sur app.inngest.com.

## Sécurité

- Aucun secret en commit (`.env*` est gitignore).
- Tokens Microsoft chiffrés en BD via `crypto.ts`.
- Rotation des secrets (`CRON_SECRET`, `BOT_SECRET`, `NEXTAUTH_SECRET`) recommandée tous les 6 mois.
- Headers de sécurité actifs (CSP, HSTS, X-Frame-Options, etc.) — voir `next.config.ts`.
- RGPD : `MinutesEditLog.contentSnapshot` purgé automatiquement après 5 ans (cron Inngest).

## Questions

Demande à un mainteneur. Le projet est petit, l'équipe aussi.
