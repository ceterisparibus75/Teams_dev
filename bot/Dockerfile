# Bot service — image Linux avec Playwright, Xvfb, PulseAudio et ffmpeg
# Déployer sur Azure Container Instance ou Azure App Service (Linux)

FROM node:20-bookworm-slim

# ── Dépendances système ──────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Navigateur Chromium + dépendances Playwright
    chromium \
    chromium-driver \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    # Écran virtuel (requis pour Playwright headless=false)
    xvfb \
    x11-utils \
    # Son virtuel (capture audio des réunions)
    pulseaudio \
    pulseaudio-utils \
    # Enregistrement audio
    ffmpeg \
    # Utilitaires
    curl \
    ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# ── Configuration PulseAudio ─────────────────────────────────────────────────
RUN mkdir -p /tmp/pulse && \
    echo "load-module module-native-protocol-unix socket=/tmp/pulse/native" >> /etc/pulse/default.pa && \
    echo "load-module module-virtual-sink sink_name=VirtualSink" >> /etc/pulse/default.pa && \
    echo "set-default-sink VirtualSink" >> /etc/pulse/default.pa

# ── Application ──────────────────────────────────────────────────────────────
WORKDIR /app

# Installer les dépendances Node
COPY package*.json ./
RUN npm ci --omit=dev

# Copier les sources du bot
COPY bot/               ./bot/
COPY prisma/            ./prisma/
COPY tsconfig.bot.json  ./

# Générer le client Prisma
RUN npx prisma generate

# Indiquer à Playwright d'utiliser le Chromium système
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Numéro d'écran Xvfb
ENV BOT_DISPLAY=:99

# ── Script de démarrage ───────────────────────────────────────────────────────
COPY bot/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
