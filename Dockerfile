# Image pour faire tourner RemoveBroker sur un serveur personnel ou un NAS.
#
# Construction en deux temps: la première image compile, la seconde ne garde que
# ce qui sert à l'exécution. Le navigateur d'automatisation n'est pas inclus,
# il pèse plus lourd que tout le reste et ne sert qu'à une minorité de courtiers.

FROM node:22-bookworm-slim AS build

WORKDIR /app

# Les manifestes d'abord: tant qu'ils ne changent pas, Docker réutilise la
# couche d'installation des dépendances.
COPY package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY scripts/postinstall.mjs scripts/

# `npm ci` est volontairement évité, et le verrou n'est pas copié.
#
# Rollup et esbuild livrent leur binaire dans une dépendance optionnelle propre
# à chaque plateforme, et npm n'inscrit dans le verrou que celle de la machine
# qui l'a généré (npm/cli#4828). Un verrou produit sous Windows ne contient
# donc aucun binaire Linux, et `npm ci`, qui refuse de s'en écarter, échoue à
# la compilation. L'intégration continue applique le même contournement.
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# Les dépendances de développement ne servent plus une fois la compilation faite.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    RB_HOST=0.0.0.0 \
    RB_PORT=7777 \
    RB_DATA_DIR=/data

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/catalog ./catalog
COPY --from=build /app/package.json ./package.json

# L'application n'a aucune raison de tourner en root.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 7777

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:7777/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/main.js"]
