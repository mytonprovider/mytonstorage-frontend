FROM node:22-alpine AS build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL
ARG VITE_SITE_URL
ARG VITE_TONCONNECT_MANIFEST_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SITE_URL=$VITE_SITE_URL
ENV VITE_TONCONNECT_MANIFEST_URL=$VITE_TONCONNECT_MANIFEST_URL
RUN pnpm build

FROM scratch AS dist
COPY --from=build /build/dist /

FROM nginx:1.30-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
