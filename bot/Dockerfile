# Bot service — image Linux avec Playwright, Xvfb, PulseAudio et ffmpeg
# Déployer sur Azure Container Instance ou Azure App Service (Linux)

FROM node:20-bookworm-slim

# ── Variables d'environnement AVANT npm install ──────────────────────────────
# Indispensable pour que Playwright ne télécharge pas Chromium pendant npm ci
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
ENV BOT_DISPLAY=:99

# ── Dépendances système ──────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
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
    xvfb \
    x11-utils \
    pulseaudio \
    pulseaudio-utils \
    ffmpeg \
    curl \
    ca-certificates \
    build-essential \
    python3 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# ── Configuration PulseAudio ─────────────────────────────────────────────────
RUN mkdir -p /tmp/pulse && \
    echo "load-module module-native-protocol-unix socket=/tmp/pulse/native" >> /etc/pulse/default.pa && \
    echo "load-module module-virtual-sink sink_name=VirtualSink" >> /etc/pulse/default.pa && \
    echo "set-default-sink VirtualSink" >> /etc/pulse/default.pa

# ── Application ──────────────────────────────────────────────────────────────
WORKDIR /app

COPY package*.json ./

# Inclure les devDependencies car ts-node et typescript sont nécessaires au runtime
RUN npm ci

COPY bot/               ./bot/
COPY prisma/            ./prisma/
COPY tsconfig.bot.json  ./

RUN npx prisma generate

COPY bot/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
