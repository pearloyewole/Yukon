FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip3 install --no-cache-dir -r ./backend/requirements.txt

COPY backend/package.json ./backend/package.json
RUN cd backend && npm install --omit=dev

COPY scripts ./scripts
COPY backend ./backend

EXPOSE 8787

CMD ["node", "backend/server.mjs"]
