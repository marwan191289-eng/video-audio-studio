# FFmpeg API — Railway Deploy

API بسيط لمعالجة الفيديو عبر FFmpeg، مصمم للنشر على Railway.

## النشر على Railway

1. اذهب إلى [railway.app](https://railway.app) وافتح مشروعك
2. اضغط **New Service → Deploy from GitHub Repo** (أو ارفع المجلد مباشرة)
3. أضف متغير البيئة التالي في Railway:
   - `CORS_ORIGIN` = عنوان تطبيق Replit الخاص بك (مثلاً: `https://your-app.replit.app`)
4. انسخ **Public Domain** من Railway (مثلاً: `https://ffmpeg-api-production.up.railway.app`)
5. أضفه في Replit كمتغير سري باسم `VITE_RAILWAY_API_URL`

## المسارات

| Method | Path | الوصف |
|--------|------|-------|
| GET | `/health` | فحص الحالة |
| POST | `/upload-chunk` | رفع جزء من الفيديو |
| POST | `/enhance` | معالجة الفيديو (يقبل session chunks أو ملف مباشر) |

## المتطلبات

- Node.js 18+
- FFmpeg (يُثبَّت تلقائياً على Railway عبر `ffmpeg-static`)

## ملاحظة

Railway تدعم ملفات حتى **5 GB** ومهلة حتى **25 دقيقة** — مثالي للفيديوهات الكبيرة.
