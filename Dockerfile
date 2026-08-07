FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
# Not compiled — accounts.controller.ts#loginScript serves this file's raw source as-is for
# download (see src/modules/accounts/accounts.controller.ts), so it has to exist at
# process.cwd()/scripts/login.ts inside the container, not just in the repo.
COPY scripts ./scripts

RUN npm run build:api

CMD ["npm", "run", "start"]
