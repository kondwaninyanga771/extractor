FROM node:18-bullseye-slim

# Install extraction tools (unrar and 7zip)
RUN apt-get update && apt-get install -y \
    p7zip-full \
    unrar \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy source code
COPY server.js ./

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
