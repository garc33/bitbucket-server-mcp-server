# Generated by https://smithery.ai. See: https://smithery.ai/docs/config#dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy source files
COPY src /app/src
COPY package.json package-lock.json tsconfig.json /app/

# Install dependencies and build the project
RUN npm install && npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/build /app/build
COPY --from=builder /app/package.json /app/package-lock.json /app/

# Install only production dependencies
RUN npm ci --omit=dev

# Environment variables (replace with your actual values)
ENV BITBUCKET_URL=https://your-bitbucket-server.com
ENV BITBUCKET_TOKEN=your-access-token

ENTRYPOINT ["node", "build/index.js"]
