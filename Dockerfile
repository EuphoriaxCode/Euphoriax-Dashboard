FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production DATA_DIR=/data
VOLUME /data
EXPOSE 3200
CMD ["node", "--no-warnings", "dist/index.js"]
