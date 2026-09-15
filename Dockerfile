FROM node:20-alpine

RUN apk update && apk add --no-cache p7zip unrar curl

WORKDIR /app

COPY package.json ./
RUN npm install

COPY server.js ./

EXPOSE 3000

CMD ["npm", "start"]
