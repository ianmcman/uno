FROM node:22-slim

WORKDIR /app

COPY package.json ./
COPY site ./site
COPY server ./server

ENV NODE_NO_WARNINGS=1 
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server/server.js"]
