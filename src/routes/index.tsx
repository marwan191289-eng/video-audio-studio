import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Sparkles, Wand2, Library, Volume2, Eraser, Terminal } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Video Enhancer Pro — تحسين الفيديو والصوت في المتصفح" },
      { name: "description", content: "أداة احترافية لتحسين جودة الفيديو، معالجة الصوت، وتعديل الوسائط مباشرة من المتصفح بدون رفع لخوادم خارجية." },
      { property: "og:title", content: "Video Enhancer Pro" },
      { property: "og:description", content: "تحسين الفيديو والصوت بالذكاء الاصطناعي وFFmpeg مباشرة في متصفحك." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(circle at 20% 20%, oklch(0.72 0.18 160 / 0.25), transparent 40%), radial-gradient(circle at 80% 30%, oklch(0.65 0.22 300 / 0.25), transparent 45%)",
        }}
      />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 font-bold text-lg">
          <Sparkles className="size-6 text-primary" />
          Video Enhancer Pro
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/enhance" className="hover:text-primary transition">المحرر</Link>
          <Link to="/terminal" className="hover:text-primary transition">تيرمنال</Link>
          <Link to="/library" className="hover:text-primary transition">مكتبتي</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-16 pb-24">
        <section className="text-center">
          <span className="inline-block rounded-full border border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
            معالجة محلية بالكامل · بدون رفع لخوادم خارجية
          </span>
          <h1 className="mt-6 text-5xl md:text-6xl font-bold leading-tight tracking-tight">
            حسّن فيديوهاتك وأصواتك
            <br />
            <span className="bg-gradient-to-l from-primary to-accent bg-clip-text text-transparent">
              باحترافية كاملة
            </span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-muted-foreground text-lg">
            ارفع، عدّل، استخرج الصوت، أزل الضوضاء، غيّر الحدّة والألوان وحمّل النتيجة—كل ذلك في متصفحك.
          </p>
          <div className="mt-10 flex justify-center gap-3">
            <Link
              to="/enhance"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 transition"
            >
              <Wand2 className="size-5" />
              ابدأ التحسين الآن
            </Link>
            <Link
              to="/terminal"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 font-semibold hover:bg-secondary transition"
            >
              <Terminal className="size-5" />
              التيرمنال
            </Link>
            <Link
              to="/library"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 font-semibold hover:bg-secondary transition"
            >
              <Library className="size-5" />
              مكتبتي
            </Link>
          </div>
        </section>

        <section className="mt-24 grid gap-6 md:grid-cols-3">
          {[
            { icon: Wand2, title: "تحسين الجودة", desc: "تعديل الحدّة، السطوع، التباين، التشبع وتقليل الضوضاء." },
            { icon: Volume2, title: "معالجة الصوت", desc: "استخرج الصوت كـ MP3، عدّل الحجم، أو احذفه نهائياً." },
            { icon: Eraser, title: "أدوات سريعة", desc: "قص، تغيير السرعة، عكس الفيديو، تغيير الدقة." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-6">
              <f.icon className="size-8 text-primary mb-3" />
              <h3 className="font-semibold text-lg mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
