# تشغيل تطبيق سطح المكتب

## المتطلبات المسبقة

```bash
npm install
```

هذا سيثبت جميع المكتبات بما فيها Electron وسيحمل الثنائي تلقائياً عبر `postinstall` script.

## تشغيل التطبيق

### في وضع التطوير (Development)

```bash
# Terminal 1: شغّل Vite dev server
npm run dev

# Terminal 2: شغّل الـ Electron app
npm run electron
```

### في وضع الإنتاج (Production)

```bash
npm run build
npm start
```

## الملفات المهمة

- `main.js` - نقطة الدخول (يستورد من `electron-main.js`)
- `electron-main.js` - منطق Electron الرئيسي
- `preload.cjs` - Preload script (يحمل الـ context bridge)
- `serve.mjs` - خادم الإنتاج الثابت

## كيف يعمل

1. **npm run electron** يشغل `node_modules/electron/cli.js .`
2. هذا يحمل `main.js` وهو يستورد من `electron-main.js`
3. `electron-main.js` ينشئ نافذة Electron ويحمل `preload.cjs`
4. في وضع التطوير، الـ app يتصل بـ Vite dev server على `http://localhost:5000`
5. في وضع الإنتاج، يشغل `serve.mjs` على `http://localhost:8080`

## تصحيح الأخطاء

إذا لم يعمل التطبيق:

```bash
# تنظيف وإعادة تثبيت كامل
rm node_modules -Force
npm install

# ثم جرّب مرة أخرى
npm run electron
```

## ملاحظات أمان

- **contextIsolation: true** - الـ context معزول
- **nodeIntegration: false** - Node لا يعمل في الـ renderer
- استخدم `preload.cjs` لـ IPC بين main و renderer
