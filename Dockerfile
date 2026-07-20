# PaperHood backend: indexer + API in one container (they share a SQLite file).
# node:22+ is required for node:sqlite; 24 matches the dev environment.
FROM node:24-alpine

WORKDIR /app

# Install dependencies per workspace (tsx is needed at runtime: the API imports
# engine TypeScript sources directly, so both services run under tsx).
COPY engine/package.json engine/package-lock.json engine/
COPY indexer/package.json indexer/package-lock.json indexer/
COPY api/package.json api/package-lock.json api/
RUN cd engine && npm ci && cd ../indexer && npm ci && cd ../api && npm ci

COPY engine/ engine/
COPY indexer/ indexer/
COPY api/ api/
COPY scripts/ scripts/

# SQLite lives under DATA_DIR; mount a volume here for persistence.
ENV DATA_DIR=/app/data
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["node", "scripts/start.mjs"]
