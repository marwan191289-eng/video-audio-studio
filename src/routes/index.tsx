import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Sparkles, Wand2, Library, Volume2, Eraser, Terminal,
  Fingerprint, Droplets, Music, Scissors, Zap, Shield,
  ChevronRight, Star, Globe, Lock, Cpu, Layers, Blend,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Video Enhancer Pro — محرر الفيديو الاحترافي" },
      { name: "description", content: "محرر فيديو وصوت احترافي بمستوى CapCut وCanva — يعمل بالكامل في متصفحك." },
    ],
  }),
  component: Index,
});

const features = [
  {
    icon: Wand2,
    title: "محرر الفيديو",
    desc: "تحسين جودة، تصحيح ألوان، نص على الفيديو، إضافة شعار، قص، دمج، تسريع، عكس، GIF وأكثر.",
    href: "/enhance",
    gradient: "from-violet-500 to-purple-600",
    badge: "20+ أداة",
  },
  {
    icon: Music,
    title: "استوديو الصوت",
    desc: "تحسين الصوت، إزالة الضوضاء، EQ ثلاثي، تطبيع، تلاشي، تغيير النبرة والسرعة، استخراج واستبدال.",
    href: "/audio",
    gradient: "from-emerald-500 to-teal-600",
    badge: "16+ أداة",
  },
  {
    icon: Blend,
    title: "تحويل احترافي",
    desc: "تغيير الصوت 8 أصوات، استبدال الخلفية (كروما)، تمويه الوجه والعناصر، وتأثيرات بصرية سينمائية.",
    href: "/transform",
    gradient: "from-fuchsia-500 to-violet-600",
    badge: "4 أدوات",
  },
  {
    icon: Droplets,
    title: "إزالة العلامات المائية",
    desc: "إزالة أي علامة مائية أو شعار من الفيديو باحترافية تامة — delogo، ضبابية، أو تغطية.",
    href: "/watermark",
    gradient: "from-rose-500 to-pink-600",
    badge: "3 طرق",
  },
  {
    icon: Fingerprint,
    title: "تغيير البصمة الرقمية",
    desc: "إعادة تشفير كامل، حذف Metadata، حقن ضوضاء دقيقة — hash جديد كلياً.",
    href: "/fingerprint",
    gradient: "from-amber-500 to-orange-600",
    badge: "4 أساليب",
  },
  {
    icon: Terminal,
    title: "تيرمنال FFmpeg",
    desc: "نفّذ أوامر FFmpeg مباشرة مع مكتبة ضخمة من السكربتات بلغات متعددة.",
    href: "/terminal",
    gradient: "from-sky-500 to-blue-600",
    badge: "50+ سكربت",
  },
  {
    icon: Layers,
    title: "معالجة دفعية",
    desc: "ارفع عشرات الفيديوهات ومرّر عليها نفس العملية — تحسين، ضغط، تحويل، استخراج صوت — ثم حمّل الكل كـ ZIP.",
    href: "/batch",
    gradient: "from-violet-500 to-indigo-600",
    badge: "جديد",
  },
  {
    icon: Library,
    title: "مكتبتي",
    desc: "جميع الفيديوهات والمقاطع المعالجة محفوظة تلقائياً — تنزيل أو حذف بنقرة.",
    href: "/library",
    gradient: "from-slate-500 to-gray-600",
    badge: "مزامنة",
  },
];

const capabilities = [
  { icon: Scissors, label: "قص وتقطيع" },
  { icon: Zap, label: "تسريع وإبطاء" },
  { icon: Volume2, label: "معالجة الصوت" },
  { icon: Eraser, label: "إزالة العلامات" },
  { icon: Shield, label: "تغيير البصمة" },
  { icon: Sparkles, label: "تحسين الجودة" },
  { icon: Globe, label: "يعمل أوف لاين" },
  { icon: Lock, label: "خصوصية تامة" },
  { icon: Cpu, label: "معالجة محلية" },
  { icon: Star, label: "جودة احترافية" },
];

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      {/* Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-violet-600/8 blur-3xl" />
        <div className="absolute top-1/3 -left-40 w-96 h-96 rounded-full bg-emerald-600/8 blur-3xl" />
        <div className="absolute -bottom-40 right-1/3 w-96 h-96 rounded-full bg-sky-600/6 blur-3xl" />
      </div>

      {/* Header */}
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 border-b border-border/50 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="flex items-center gap-2.5 font-extrabold text-xl">
          <div className="p-1.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/30">
            <Sparkles className="size-5 text-white" />
          </div>
          Video Enhancer Pro
        </div>
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground">
          <Link to="/enhance" className="hover:text-foreground transition">المحرر</Link>
          <Link to="/audio" className="hover:text-foreground transition">الصوت</Link>
          <Link to="/watermark" className="hover:text-foreground transition">العلامات المائية</Link>
          <Link to="/terminal" className="hover:text-foreground transition">التيرمنال</Link>
          <Link to="/library" className="hover:text-foreground transition">مكتبتي</Link>
        </nav>
        <Link to="/enhance"
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:opacity-90 transition shadow-lg shadow-violet-500/25">
          <Wand2 className="size-4" /> ابدأ الآن
        </Link>
      </header>

      <main className="mx-auto max-w-7xl px-6 pt-20 pb-32">
        {/* Hero */}
        <section className="text-center mb-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-1.5 text-xs text-muted-foreground mb-8 backdrop-blur-sm">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            معالجة محلية 100% · لا رفع لأي خادم · مجانية تماماً
          </div>

          <h1 className="text-5xl md:text-7xl font-black leading-[1.1] tracking-tight mb-6">
            محرر فيديو
            <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-purple-400 to-pink-400">
              احترافي شامل
            </span>
          </h1>

          <p className="mt-4 max-w-3xl mx-auto text-muted-foreground text-lg leading-relaxed">
            كل ما تحتاجه في مكان واحد — تحسين الجودة، معالجة الصوت، نص على الفيديو، إزالة العلامات المائية،
            تغيير البصمة الرقمية، وتيرمنال FFmpeg متكامل. مثل CapCut وCanva لكن في متصفحك مباشرة.
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link to="/enhance"
              className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-8 py-4 font-bold text-white hover:opacity-90 transition text-base shadow-xl shadow-violet-500/25 hover:shadow-violet-500/40">
              <Wand2 className="size-5" /> محرر الفيديو
              <ChevronRight className="size-4" />
            </Link>
            <Link to="/audio"
              className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card/60 px-8 py-4 font-bold hover:bg-secondary transition text-base backdrop-blur-sm">
              <Music className="size-5 text-emerald-400" /> استوديو الصوت
            </Link>
            <Link to="/terminal"
              className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card/60 px-8 py-4 font-bold hover:bg-secondary transition text-base backdrop-blur-sm">
              <Terminal className="size-5 text-sky-400" /> التيرمنال
            </Link>
          </div>

          {/* Capabilities */}
          <div className="mt-12 flex flex-wrap justify-center gap-2.5">
            {capabilities.map((c) => (
              <div key={c.label}
                className="flex items-center gap-2 rounded-full bg-card/50 border border-border/60 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur-sm hover:border-violet-500/40 hover:text-foreground transition cursor-default">
                <c.icon className="size-3.5 text-violet-400" />
                {c.label}
              </div>
            ))}
          </div>
        </section>

        {/* Features Grid */}
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-20">
          {features.map((f) => (
            <Link key={f.title} to={f.href as any}
              className="group relative rounded-3xl border border-border bg-card/40 p-7 hover:border-violet-500/40 hover:bg-card/70 transition-all duration-300 hover:shadow-xl hover:shadow-violet-500/8 backdrop-blur-sm overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500/0 to-violet-500/0 group-hover:from-violet-500/3 group-hover:to-transparent transition-all duration-500" />
              <div className="relative">
                <div className="flex items-start justify-between mb-4">
                  <div className={`inline-flex rounded-2xl bg-gradient-to-br ${f.gradient} p-3.5 shadow-lg`}>
                    <f.icon className="size-6 text-white" />
                  </div>
                  <span className="text-[10px] font-bold text-muted-foreground border border-border rounded-full px-2.5 py-1 bg-background/60">
                    {f.badge}
                  </span>
                </div>
                <h3 className="font-black text-lg mb-2 group-hover:text-violet-400 transition">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                <div className="mt-5 flex items-center gap-1.5 text-xs text-violet-400 font-bold opacity-0 group-hover:opacity-100 transition">
                  افتح القسم <ChevronRight className="size-3.5" />
                </div>
              </div>
            </Link>
          ))}
        </section>

        {/* Tech Section */}
        <section className="rounded-3xl border border-border bg-card/30 p-10 text-center backdrop-blur-sm">
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 border border-violet-500/20 px-4 py-1.5 text-xs text-violet-400 font-bold mb-5">
            <Cpu className="size-3.5" /> التقنية المستخدمة
          </div>
          <h2 className="text-2xl font-black mb-3">يعمل بالكامل في متصفحك</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            يستخدم هذا التطبيق تقنية <strong className="text-foreground">FFmpeg.wasm</strong> لمعالجة الوسائط
            مباشرةً في المتصفح دون رفع أي ملف لخوادم خارجية.
            بياناتك تبقى على جهازك دائماً — خصوصية تامة وسرعة فائقة.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
            {[
              { color: "bg-violet-400", text: "FFmpeg.wasm" },
              { color: "bg-blue-400", text: "React 19" },
              { color: "bg-purple-400", text: "TanStack" },
              { color: "bg-emerald-400", text: "PostgreSQL" },
              { color: "bg-amber-400", text: "Vite 8" },
              { color: "bg-pink-400", text: "Tailwind 4" },
            ].map(({ color, text }) => (
              <span key={text} className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${color}`} />{text}
              </span>
            ))}
          </div>
        </section>

        {/* Developer Signature */}
        <footer className="mt-8 mb-4 text-center">
          <div className="inline-flex items-center gap-2.5 rounded-2xl border border-violet-500/20 bg-violet-500/5 px-5 py-2.5 backdrop-blur-sm">
            <span className="size-2 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-xs text-muted-foreground">Developer:</span>
            <span className="text-xs font-bold text-violet-400 tracking-wide">Marwan Negm</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
