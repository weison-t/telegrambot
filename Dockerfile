# Long-running Telegram worker + control API (deploy separately from the Vercel dashboard).
FROM node:20-alpine

WORKDIR /app

# tsx is a devDependency but required at runtime for worker:start.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY worker ./worker
COPY lib ./lib

ENV NODE_ENV=production
ENV WORKER_HOST=0.0.0.0

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || process.env.WORKER_PORT || 8787) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "worker:start"]
