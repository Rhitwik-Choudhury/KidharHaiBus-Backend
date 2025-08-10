# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# ---- Runtime stage ----
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app

# Fly prefers apps to listen on 8080
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
