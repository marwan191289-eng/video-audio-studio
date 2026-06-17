# 🚀 تحسينات الأداء — Video/Audio Studio

## المشكلة

كانت جميع عمليات الفيديو (قص، فلاتر، تأثيرات، تحويل) تعمل على **خيط CPU واحد فقط**،
مما يجعلها أبطأ بـ 4-8 مرات من الإمكانية الحقيقية للجهاز.

---

## التحسينات المطبّقة

### ✅ 1. FFmpeg متعدد الخيوط (الأهم!)

تم إضافة `@ffmpeg/core-mt` — نسخة FFmpeg مُترجمة مع دعم الـ pthreads الحقيقية.

**النتيجة:** تشغيل جميع أنوية المعالج بدلاً من نواة واحدة → **4-8× أسرع**.

الكود يكشف تلقائياً إذا كان المتصفح يدعم `SharedArrayBuffer` ويحمّل:

- ✅ النسخة السريعة MT إذا كان `crossOriginIsolated = true`
- ⚠️ النسخة العادية ST كـ fallback آمن

---

### ✅ 2. COOP/COEP Headers محكمة

يُضاف هذا الهيدر على **كل رد** من السيرفر (ضروري لـ SharedArrayBuffer):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

---

### ✅ 3. serve.mjs محسّن

- ضغط Gzip تلقائي لملفات JS/CSS/HTML
- Cache طويل الأمد (1 سنة) لملفات WASM والـ bundles ذات الـ hash
- لا cache لـ HTML (دائماً أحدث نسخة)

---

### ✅ 4. Vite Build محسّن

- تقسيم ذكي للـ chunks (ffmpeg / radix / icons / charts منفصلة)
- esbuild للضغط (أسرع build، حجم أصغر)
- `@ffmpeg/*` خارج pre-bundling (WASM لا يمكن bundleه)

---

### ✅ 5. مؤشر وضع الأداء في الواجهة

يظهر badge في الصفحة الرئيسية يُخبرك بوضع FFmpeg:

- 🟢 **وضع سريع** — متعدد الخيوط مفعّل
- 🟡 **وضع عادي** — أحادي الخيط (fallback)

---

## التوقعات

| العملية           | قبل (خيط واحد) | بعد (متعدد الخيوط) |
| ----------------- | -------------- | ------------------ |
| ترميز H.264 1080p | ~60 ثانية      | ~10 ثوانٍ          |
| فلاتر الألوان     | ~20 ثانية      | ~4 ثوانٍ           |
| معالجة الصوت      | ~5 ثوانٍ       | ~2 ثانية           |
| تحويل الصيغة      | ~30 ثانية      | ~6 ثوانٍ           |

_التحسين الفعلي يعتمد على عدد أنوية المعالج في جهازك._

---

## متطلبات الوضع السريع

1. خادم يُرسل COOP/COEP headers ✅ (مُفعّل في serve.mjs)
2. HTTPS أو localhost ✅
3. متصفح حديث (Chrome 92+، Firefox 79+، Edge 92+) ✅

---

## كيفية التشغيل

```bash
# 1 — استنساخ المشروع
git clone https://github.com/marwan191289-eng/video-audio-studio.git
cd video-audio-studio

# 2 — تثبيت المكتبات (يُنزّل ملفات FFmpeg MT تلقائياً)
npm install --legacy-peer-deps

# 3 — بناء التطبيق (يُضيف ملفات WASM إلى dist/)
npm run build

# 4 — تشغيل التطبيق
node serve.mjs
```
