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
- **Plan**: Starter (or higher) - **Need at least 512MB RAM for Orama index**

### 4. Web Service (Frontend) - `ilm-web`
- **Type**: Web Service
- **Build Command**: `cd apps/web && npm ci && npm run build`
- **Start Command**: `cd apps/web && npm run start`
- **Environment**: Node
- **Region**: Same as database
- **Plan**: Starter

## Environment Variables for `ilm-api`

| Key | Value | Source |
|-----|-------|--------|
| `NODE_ENV` | `production` | - |
| `DATABASE_URL` | `postgresql://...` | From `ilm-db` External URL |
| `REDIS_URL` | `redis://...` | From `ilm-redis` External URL |
| `TYPESAFE_API_KEY` | `your-typesafe-key` | From typesafe.ai |
| `OPENAI_API_KEY` | `your-openai-key` | From platform.openai.com |
| `CORS_ORIGIN` | `https://ilm-web.onrender.com` | Your web URL |
| `PORT` | `4000` | - |
| `LOG_LEVEL` | `info` | - |

**Note**: No Meilisearch or Qdrant needed! OramaJS runs in-memory inside the API process.

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

  # API Web Service
  - type: web
    name: ilm-api
    plan: starter  # Need 512MB+ for Orama index
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

2. **Set secret environment variables** in `ilm-api`:
   - `TYPESAFE_API_KEY`
   - `OPENAI_API_KEY`

3. **Deploy in order**:
   - Database → Redis → API → Web

4. **Run migrations** after API deploys:
   ```bash
   # In Render shell for ilm-api
   cd apps/api && npm run db:push
   ```

5. **Ingest data** (one-time):
   ```bash
   # In Render shell for ilm-api
   npx tsx scripts/ingest.ts
   # Index builds automatically on first search, or trigger:
   npx tsx scripts/index.ts
   ```

## Memory Considerations

- **OramaJS is in-memory** - the index lives in the API process RAM
- For ~43k verses with text + embeddings: ~200-500MB
- **Use at least Starter plan (512MB)** on Render
- Index rebuilds on startup from PostgreSQL (fast - few seconds)

## Custom Domains (Optional)
- API: `api.ilm.app` → `ilm-api.onrender.com`
- Web: `ilm.app` → `ilm-web.onrender.com`

## Persistence Note

Orama index is persisted to disk (`data/orama-index/`) on Render's ephemeral filesystem. On restart:
1. API starts
2. Orama loads index from disk (if exists) or rebuilds from PostgreSQL
3. First request may be slower if rebuild needed

For production, consider:
- Using Render Disk (persistent volume) for `/app/data`
- Or accepting rebuild-on-start (fast enough for this dataset size)