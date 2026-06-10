
CREATE TABLE public.processed_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size_bytes BIGINT,
  settings JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.processed_videos TO anon, authenticated;
GRANT ALL ON public.processed_videos TO service_role;
ALTER TABLE public.processed_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON public.processed_videos FOR SELECT USING (true);
CREATE POLICY "public insert" ON public.processed_videos FOR INSERT WITH CHECK (true);
CREATE POLICY "public delete" ON public.processed_videos FOR DELETE USING (true);

-- Storage policies for 'videos' bucket (anon allowed)
CREATE POLICY "videos read" ON storage.objects FOR SELECT USING (bucket_id = 'videos');
CREATE POLICY "videos insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'videos');
CREATE POLICY "videos delete" ON storage.objects FOR DELETE USING (bucket_id = 'videos');
