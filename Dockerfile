FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY server.js ./
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 3000
CMD ["node", "server.js"]
