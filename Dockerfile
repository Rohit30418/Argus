FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data/scans /app/data/screenshots \
    && chown -R pwuser:pwuser /app

ENV NODE_ENV=production
ENV PORT=10000
ENV ARGUS_HEADLESS=true
ENV ARGUS_BROWSER_NO_SANDBOX=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

USER pwuser

EXPOSE 10000

CMD ["npm", "start"]
