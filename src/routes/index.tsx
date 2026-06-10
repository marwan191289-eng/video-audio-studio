import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Sparkles,
  Wand2,
  Library,
  Volume2,
  Eraser,
  Terminal,
  Fingerprint,
  Droplets,
  Music,
  Scissors,
  Zap,
  Shield,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Video Enhancer Pro — محرر الفيديو والصوت الاحترافي" },
      {
        name: "description",
        content:
          "أداة شاملة لتحسين الفيديو والصوت، إزالة العلامات المائية، تغيير البصمة الرقمية، ومعالجة الوسائط مباشرة في المتصفح.",
      },
    ],
  }),
  component: Index,
});

const features = [
  {
    icon: Wand2,
    title: "محرر الفيديو",
    desc: "تحسين الجودة، السطوع، التباين، الحدّة، التشبع، تقليل الضوضاء، قص، دمج، تسريع، عكس.",
    href: "/enhance",
    color: "from-violet-500 to-purple-600",
  },
  {
    icon: Music,
    title: "استوديو الصوت",
    desc: "تحسين الصوت، إزالة الضوضاء، تطبيع المستوى، استخراج، استبدال، تغيير النبرة والسرعة.",
    href: "/audio",
    color: "from-emerald-500 to-teal-600",
  },
  {
    icon: Droplets,
    title: "إزالة العلامات المائية",
    desc: "إزالة أي علامة مائية أو شعار من الفيديو باحترافية تامة بدون أي أثر.",
    href: "/watermark",
    color: "from-rose-500 to-pink-600",
  },
  {
    icon: Fingerprint,
    title: "تغيير البصمة الرقمية",
    desc: "إعادة تشفير الفيديو وتغيير البيانات الوصفية والبصمة الرقمية بالكامل.",
    href: "/fingerprint",
    color: "from-amber-500 to-orange-600",
  },
  {
    icon: Terminal,
    title: "تيرمنال FFmpeg",
    desc: "نفّذ أوامر FFmpeg مباشرة مع مكتبة غنية من السكربتات بلغات متعددة.",
    href: "/terminal",
    color: "from-sky-500 to-blue-600",
  },
  {
    icon: Library,
    title: "مكتبتي",
    desc: "كل الملفات المعالجة محفوظة في مكان واحد — تنزيل، مشاركة، أو حذف.",
    href: "/library",
    color: "from-slate-500 to-gray-600",
  },
];

const capabilities = [
  { icon: Scissors, label: "قص وتقطيع" },
  { icon: Zap, label: "تسريع وإبطاء" },
  { icon: Volume2, label: "معالجة الصوت" },
  { icon: Eraser, label: "إزالة العلامات" },
  { icon: Shield, label: "تغيير البصمة" },
  { icon: Sparkles, label: "تحسين الجودة" },
];

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div
        className="fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(circle at 15% 15%, oklch(0.72 0.18 160 / 0.12), transparent 40%), radial-gradient(circle at 85% 20%, oklch(0.65 0.22 300 / 0.12), transparent 40%), radial-gradient(circle at 50% 80%, oklch(0.70 0.20 240 / 0.08), transparent 40%)",
        }}
      />

      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 border-b border-border/60 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="flex items-center gap-2.5 font-bold text-xl">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Sparkles className="size-6 text-primary" />
          </div>
          Video Enhancer Pro
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <Link to="/enhance" className="hover:text-primary transition">المحرر</Link>
          <Link to="/audio" className="hover:text-primary transition">الصوت</Link>
          <Link to="/watermark" className="hover:text-primary transition">العلامات المائية</Link>
          <Link to="/fingerprint" className="hover:text-primary transition">البصمة الرقمية</Link>
          <Link to="/terminal" className="hover:text-primary transition">تيرمنال</Link>
        </nav>
        <Link
          to="/enhance"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
        >
          <Wand2 className="size-4" />
          ابدأ الآن
        </Link>
      </header>

      <main className="mx-auto max-w-7xl px-6 pt-20 pb-32">
        <section className="text-center mb-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-4 py-1.5 text-xs text-muted-foreground mb-6">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            معالجة محلية بالكامل · بدون رفع لخوادم خارجية · مجانية تماماً
          </span>

          <h1 className="text-5xl md:text-7xl font-extrabold leading-tight tracking-tight">
            محرر فيديو
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(135deg, oklch(0.72 0.18 160), oklch(0.65 0.22 300))",
              }}
            >
              احترافي شامل
            </span>
          </h1>

          <p className="mt-6 max-w-3xl mx-auto text-muted-foreground text-lg leading-relaxed">
            كل ما تحتاجه في مكان واحد — تحسين الجودة، معالجة الصوت، إزالة العلامات المائية،
            تغيير البصمة الرقمية، وتيرمنال برمجي متكامل. مثل CapCut وCanva لكن في متصفحك مباشرة.
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              to="/enhance"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 font-semibold text-primary-foreground hover:opacity-90 transition text-base shadow-lg shadow-primary/20"
            >
              <Wand2 className="size-5" />
              محرر الفيديو
            </Link>
            <Link
              to="/audio"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-8 py-3.5 font-semibold hover:bg-secondary transition text-base"
            >
              <Music className="size-5" />
              استوديو الصوت
            </Link>
            <Link
              to="/terminal"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-8 py-3.5 font-semibold hover:bg-secondary transition text-base"
            >
              <Terminal className="size-5" />
              التيرمنال
            </Link>
          </div>

          <div className="mt-12 flex flex-wrap justify-center gap-4">
            {capabilities.map((c) => (
              <div key={c.label} className="flex items-center gap-2 rounded-full bg-card/60 border border-border/60 px-4 py-1.5 text-sm text-muted-foreground">
                <c.icon className="size-3.5 text-primary" />
                {c.label}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Link
              key={f.title}
              to={f.href as any}
              className="group rounded-2xl border border-border bg-card/60 p-6 hover:border-primary/40 hover:bg-card transition-all hover:shadow-lg hover:shadow-primary/5"
            >
              <div
                className={`mb-4 inline-flex rounded-xl bg-gradient-to-br ${f.color} p-3 shadow-lg`}
              >
                <f.icon className="size-6 text-white" />
              </div>
              <h3 className="font-bold text-lg mb-2 group-hover:text-primary transition">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              <div className="mt-4 text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition">
                افتح القسم ←
              </div>
            </Link>
          ))}
        </section>

        <section className="mt-20 rounded-2xl border border-border bg-card/40 p-10 text-center">
          <h2 className="text-2xl font-bold mb-3">يعمل بالكامل في متصفحك</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            يستخدم هذا التطبيق تقنية <strong className="text-foreground">FFmpeg.wasm</strong> لمعالجة الوسائط
            مباشرة في المتصفح دون الحاجة لرفع أي ملف لخوادم خارجية. بياناتك تبقى على جهازك دائماً.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-400" />FFmpeg.wasm</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-blue-400" />React 19</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-purple-400" />TanStack</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-400" />Supabase</span>
          </div>
        </section>
      </main>
    </div>
  );
}
