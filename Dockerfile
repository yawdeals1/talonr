FROM mcr.microsoft.com/playwright:v1.62.1-jammy

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

# Built into the same image so this container can serve the frontend directly. Whichever target
# most recently published an HTTP port is where talonr.deploro.app's DNS points (VPS compute vs.
# the Cloudflare Worker) — when it's this container, it needs to be self-sufficient rather than
# 404 on every non-API route. VITE_API_URL=/api (not the Worker deploy's /backend proxy path) —
# here the browser talks to this same Express process directly with no proxy layer, and the
# Deploro-edge /api reservation (see frontend/src/lib/config.ts) only applies to Worker-routed
# domains, not a domain routed straight to a VPS origin.
COPY frontend ./frontend
ENV VITE_API_URL=/api
RUN npm --prefix frontend ci && npm --prefix frontend run build

CMD ["npm", "run", "start"]
