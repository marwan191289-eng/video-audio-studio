/**
 * FFmpegModeBadge
 * Shows a small badge indicating whether FFmpeg is running in multi-thread
 * (fast) or single-thread (fallback) mode.
 */
import { useEffect, useState } from "react";
import { Zap, AlertTriangle } from "lucide-react";

export function FFmpegModeBadge() {
  const [mt, setMt] = useState<boolean | null>(null);

  useEffect(() => {
    setMt(
      typeof SharedArrayBuffer !== "undefined" &&
        typeof crossOriginIsolated !== "undefined" &&
        crossOriginIsolated === true,
    );
  }, []);

  if (mt === null) return null;

  return mt ? (
    <span
      title="وضع متعدد الخيوط مفعّل — معالجة الفيديو أسرع بـ 4-8 مرات"
      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/30"
    >
      <Zap className="h-3 w-3" />
      وضع سريع
    </span>
  ) : (
    <span
      title="وضع أحادي الخيط — تأكد من HTTPS وإعدادات الخادم للحصول على الأداء الكامل"
      className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/30"
    >
      <AlertTriangle className="h-3 w-3" />
      وضع عادي
    </span>
  );
}
