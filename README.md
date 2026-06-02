# ArtAd Studio — Marta Mescar

AI-powered Meta ad creative editor with real video processing.

## Deploy to Railway (10 minutes)

### Step 1 — GitHub
1. Go to github.com → New repository
2. Name it `artad-studio` → Create repository
3. Upload all these files to it

### Step 2 — Railway
1. Go to railway.app → Login with GitHub
2. New Project → Deploy from GitHub repo → select `artad-studio`
3. Railway auto-detects Node.js and deploys

### Step 3 — Environment variable
1. In Railway: your project → Variables tab
2. Add: `ANTHROPIC_API_KEY` = your key from console.anthropic.com

### Step 4 — Done
Railway gives you a URL like `https://artad-studio-production.up.railway.app`
Open it — the app is live and processes real video.

## What it does
- Upload image or video
- Claude analyses for conversion (competitor data, neuromarketing, Meta algorithm)
- FFmpeg processes the actual video: colour grade, warmth, vignette, text overlays, hook text
- Download MP4 ready to upload to Meta Ads Manager
- Ad copy (3 variants), audience targeting, campaign settings all generated
