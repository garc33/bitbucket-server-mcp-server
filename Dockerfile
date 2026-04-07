FROM node:22-alpine AS base

RUN npm install -g @pavel-kalmykov/bitbucket-server-mcp

USER node

ENTRYPOINT ["bitbucket-server-mcp"]
