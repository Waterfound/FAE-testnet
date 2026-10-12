FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY fae-node.mjs ./
ENV FAE_HOST=0.0.0.0 \
    FAE_PORT=8787 \
    FAE_DATA_FILE=/data/fae-state.json
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node","fae-node.mjs"]
