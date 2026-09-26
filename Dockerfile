FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY storefront/package*.json storefront/
RUN cd storefront && npm ci
COPY storefront storefront
RUN cd storefront && npm run build:selfhost

FROM node:26-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY commerce/package*.json commerce/
RUN cd commerce && npm ci --omit=dev
COPY commerce/server.js commerce/server.js
COPY --from=build /app/storefront/out storefront/out
COPY repo/public repo/public
RUN mkdir -p .private/packages && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "commerce/server.js"]
