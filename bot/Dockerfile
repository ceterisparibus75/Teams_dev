# Bot service — image Linux avec Playwright, Xvfb, PulseAudio et ffmpeg

FROM node:20-bookworm-slim

# Doit être défini AVANT npm install pour bloquer le téléchargement des navigateurs
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
    python3 \
    make \
    g++ \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# ── Configuration PulseAudio ─────────────────────────────────────────────────
RUN mkdir -p /tmp/pulse && \
    echo "load-module module-native-protocol-unix socket=/tmp/pulse/native" >> /etc/pulse/default.pa && \
    echo "load-module module-virtual-sink sink_name=VirtualSink" >> /etc/pulse/default.pa && \
    echo "set-default-sink VirtualSink" >> /etc/pulse/default.pa

# ── Application ──────────────────────────────────────────────────────────────
WORKDIR /app

# Utiliser le package.json minimal du bot uniquement
COPY bot/package.json ./package.json

RUN npm install

COPY bot/               ./bot/
COPY prisma/            ./prisma/
COPY tsconfig.bot.json  ./

RUN npx prisma generate

COPY bot/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
