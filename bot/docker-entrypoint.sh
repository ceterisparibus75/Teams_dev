#!/bin/bash
set -e

# Démarrage de l'écran virtuel Xvfb
Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
sleep 1

# Démarrage du daemon PulseAudio (son virtuel)
pulseaudio --start --exit-idle-time=-1 --daemon 2>/dev/null || true
sleep 1

# Migration Prisma si nécessaire
npx prisma migrate deploy 2>/dev/null || true

# Démarrage du service bot
exec npx ts-node --project tsconfig.bot.json bot/index.ts
