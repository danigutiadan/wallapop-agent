FROM node:20-bookworm

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Install Playwright browsers and their OS dependencies 
# (We only install chromium to keep the image size smaller, as it's what Playwright and whatsapp-web.js use)
RUN npx playwright install --with-deps chromium

# Copy application source code
COPY . .

# Run the agent continuously
CMD ["node", "agent.js"]
