import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listVideos, deleteVideo, getVideoDownloadPath } from "@/lib/api/library.functions";
import { ArrowRight, Trash2, Download, Library as LibIcon } from "lucide-react";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "مكتبتي — Video Enhancer Pro" },
      { name: "description", content: "كل الفيديوهات والمقاطع التي عالجتها محفوظة في مكان واحد." },
    ],
  }),
  component: LibraryPage,
});

type Row = {
  id: string;
  name: string;
  storage_path: string;
  size_bytes: number | null;
  created_at: string;
};

function LibraryPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["library"],
    queryFn: () => listVideos(),
  });

  const del = useMutation({
    mutationFn: async (row: Row) => {
      await deleteVideo({ data: { id: row.id, storagePath: row.storage_path } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
  });

  async function download(row: Row) {
    try {
      const { url } = await getVideoDownloadPath({ data: { storagePath: row.storage_path } });
      window.open(url, "_blank");
    } catch {
      alert("تعذّر إنشاء الرابط");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 border-b border-border">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="size-4" />
          الرئيسية
        </Link>
        <Link to="/enhance" className="text-sm hover:text-primary">
          المحرر
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <LibIcon className="size-7 text-primary" />
          <h1 className="text-2xl font-bold">مكتبتي</h1>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">جاري التحميل...</p>
        ) : !data || data.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <p className="text-muted-foreground mb-4">لا توجد فيديوهات محفوظة بعد.</p>
            <Link
              to="/enhance"
              className="inline-flex rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground"
            >
              ابدأ معالجة فيديو
            </Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {data.map((row) => (
              <div
                key={row.id}
                className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{row.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.size_bytes ? (row.size_bytes / 1024 / 1024).toFixed(1) + " MB · " : ""}
                    {new Date(row.created_at).toLocaleString("ar")}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => download(row)}
                    className="rounded-lg border border-border bg-card p-2 hover:bg-secondary"
                    title="تنزيل"
                  >
                    <Download className="size-4" />
                  </button>
                  <button
                    onClick={() => confirm("حذف نهائياً؟") && del.mutate(row)}
                    className="rounded-lg border border-border bg-card p-2 hover:bg-destructive hover:text-destructive-foreground"
                    title="حذف"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
