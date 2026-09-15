FROM node:18-bullseye-slim

RUN sed -i -e 's/main$/main contrib non-free/g' /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian bullseye non-free" >> /etc/apt/sources.list && \
    apt-get update && apt-get install -y \
    p7zip-full \
    unrar \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY server.js ./

EXPOSE 3000

CMD ["npm", "start"]
