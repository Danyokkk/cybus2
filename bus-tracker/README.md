# CyBus

CyBus is a production-ready Cyprus transit web app built on the official GTFS static files from [motionbuscard.org.cy](https://motionbuscard.org.cy/opendata) plus the GTFS-RT realtime vehicle feed.

## What is included

- Next.js frontend with a dark liquid-glass interface
- MapLibre GL JS live map for all active buses
- Express backend that loads bundled Cyprus GTFS datasets
- Realtime GTFS-RT polling and normalization
- Favourites, Nearby Stops, Lines and Schedules, Directions helper
- Language switching for English, Greek, and Russian

## Project structure

- `backend/`: transit API and GTFS/GTFS-RT ingestion
- `frontend/`: web app UI

## Local development

### 1. Backend

```bash
cd backend
cp .env.example .env
npm install
npm start
```

Default backend URL: `http://localhost:3001`

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Default frontend URL: `http://localhost:3000`

## Production deployment on Render

The repository includes a Render blueprint at `../render.yaml`.

### Recommended setup

Deploy two services:

1. `cybus-api`
2. `cybus-web`

### Environment variables

#### Backend

- `ALLOWED_ORIGINS=https://your-frontend-domain.onrender.com`
- `PORT=3001`

#### Frontend

- `NEXT_PUBLIC_API_URL=https://your-backend-domain.onrender.com`

### Deploy flow

1. Push this project to GitHub.
2. In Render, create a new Blueprint from that GitHub repo.
3. Render will detect `render.yaml` and propose both services.
4. Set `NEXT_PUBLIC_API_URL` on `cybus-web` to your backend Render URL.
5. Set `ALLOWED_ORIGINS` on `cybus-api` to your frontend Render URL.
6. Deploy both services.
7. After the backend is live, redeploy the frontend once so the public API URL is baked into the Next.js build.

### Important note

`NEXT_PUBLIC_API_URL` is a build-time variable in Next.js, so whenever you change the backend URL you should redeploy the frontend.

## Build checks

### Frontend

```bash
cd frontend
npm run build
```

### Backend syntax check

```bash
cd backend
node --check server.js
```
