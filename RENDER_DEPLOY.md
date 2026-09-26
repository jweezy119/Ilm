# Ilm - Render Deployment Configuration

This file documents the services and environment variables needed for deploying to Render.

## Services to Create on Render

### 1. PostgreSQL Database
- **Name**: `ilm-db`
- **Plan**: Starter (or higher)
- **Region**: Choose closest to users
- **Note**: Copy the `External Database URL` for `DATABASE_URL`

### 2. Redis
- **Name**: `ilm-redis`
- **Plan**: Starter
- **Region**: Same as database
- **Note**: Copy the `External Connection URL` for `REDIS_URL`

### 3. Web Service (API) - `ilm-api`
- **Type**: Web Service
- **Build Command**: `cd apps/api && npm ci && npm run build`
- **Start Command**: `cd apps/api && npm run start`
- **Environment**: Node
- **Region**: Same as database
- **Plan**: Starter (or higher)

### 4. Static Site (Web) - `ilm-web`
- **Type**: Static Site
- **Build Command**: `cd apps/web && npm ci && npm run build`
- **Publish Directory**: `apps/web/out` (if using `output: 'export'`) OR use Web Service instead

**Alternative**: Deploy web as Web Service:
- **Type**: Web Service
- **Build Command**: `cd apps/web && npm ci && npm run build`
- **Start Command**: `cd apps/web && npm run start`
- **Environment**: Node

## Environment Variables for `ilm-api`

| Key | Value | Source |
|-----|-------|--------|
| `NODE_ENV` | `production` | - |
| `DATABASE_URL` | `postgresql://...` | From `ilm-db` External URL |
| `REDIS_URL` | `redis://...` | From `ilm-redis` External URL |
| `MEILISEARCH_HOST` | `https://your-meilisearch.render.com` | See below |
| `MEILISEARCH_API_KEY` | `your-master-key` | Set in Meilisearch |
| `QDRANT_URL` | `https://your-qdrant.render.com` | See below |
| `QDRANT_API_KEY` | `your-api-key` | Set in Qdrant |
| `TYPESAFE_API_KEY` | `your-typesafe-key` | From typesafe.ai |
| `OPENAI_API_KEY` | `your-openai-key` | From platform.openai.com |
| `CORS_ORIGIN` | `https://ilm-web.onrender.com` | Your web URL |
| `PORT` | `4000` | - |
| `LOG_LEVEL` | `info` | - |

## Meilisearch & Qdrant on Render

### Option A: Render Private Services (Recommended)
Create as **Private Services** in same region:
- **Meilisearch**: Docker image `getmeili/meilisearch:v1.10`
  - Env: `MEILI_MASTER_KEY=your-key`
  - Port: 7700
- **Qdrant**: Docker image `qdrant/qdrant:v1.8`
  - Port: 6333

### Option B: External Managed Services
- **Meilisearch Cloud**: https://cloud.meilisearch.com
- **Qdrant Cloud**: https://cloud.qdrant.io

## Environment Variables for `ilm-web`

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://ilm-api.onrender.com` |

## Render.yaml (Infrastructure as Code)

```yaml
services:
  # Database
  - type: pserv
    name: ilm-db
    plan: starter
    region: oregon
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: ilm-db
          property: connectionString

  # Redis
  - type: pserv
    name: ilm-redis
    plan: starter
    region: oregon
    envVars:
      - key: REDIS_URL
        fromService:
          name: ilm-redis
          type: pserv
          property: connectionString

  # Meilisearch (Private Service)
  - type: pserv
    name: ilm-meilisearch
    plan: starter
    region: oregon
    dockerfilePath: ./Dockerfile.meilisearch
    envVars:
      - key: MEILI_MASTER_KEY
        generateValue: true
    port: 7700

  # Qdrant (Private Service)
  - type: pserv
    name: ilm-qdrant
    plan: starter
    region: oregon
    dockerfilePath: ./Dockerfile.qdrant
    port: 6333

  # API Web Service
  - type: web
    name: ilm-api
    plan: starter
    region: oregon
    buildCommand: cd apps/api && npm ci && npm run build
    startCommand: cd apps/api && npm run start
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: ilm-db
          property: connectionString
      - key: REDIS_URL
        fromService:
          name: ilm-redis
          type: pserv
          property: connectionString
      - key: MEILISEARCH_HOST
        value: http://ilm-meilisearch:7700
      - key: MEILISEARCH_API_KEY
        fromService:
          name: ilm-meilisearch
          type: pserv
          envVarKey: MEILI_MASTER_KEY
      - key: QDRANT_URL
        value: http://ilm-qdrant:6333
      - key: TYPESAFE_API_KEY
        sync: false
      - key: OPENAI_API_KEY
        sync: false
      - key: CORS_ORIGIN
        value: https://ilm-web.onrender.com
      - key: PORT
        value: 4000

  # Web Service (Frontend)
  - type: web
    name: ilm-web
    plan: starter
    region: oregon
    buildCommand: cd apps/web && npm ci && npm run build
    startCommand: cd apps/web && npm run start
    envVars:
      - key: NEXT_PUBLIC_API_URL
        value: https://ilm-api.onrender.com
```

## Quick Setup Steps

1. **Create services in Render dashboard** (or use `render.yaml` via "New Blueprint Instance")

2. **Set secret environment variables** in each service:
   - `ilm-api`: `TYPESAFE_API_KEY`, `OPENAI_API_KEY`
   - `ilm-meilisearch`: `MEILI_MASTER_KEY` (auto-generated)

3. **Deploy in order**:
   - Database → Redis → Meilisearch → Qdrant → API → Web

4. **Run migrations** after API deploys:
   ```bash
   # In Render shell for ilm-api
   cd apps/api && npm run db:push
   ```

5. **Ingest data** (one-time):
   ```bash
   # In Render shell for ilm-api
   npx tsx scripts/ingest.ts
   npx tsx scripts/index.ts
   ```

## Custom Domains (Optional)
- API: `api.ilm.app` → `ilm-api.onrender.com`
- Web: `ilm.app` → `ilm-web.onrender.com`