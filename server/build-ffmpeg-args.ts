export interface EnhanceSettings {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  sharpness?: number;
  gamma?: number;
  denoiseFilter?: "none" | "hqdn3d" | "nlmeans";
  denoiseStrength?: "light" | "medium" | "strong";
  autoLevel?: "light" | "balanced" | "strong";
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  rotateDir?: "90cw" | "90ccw" | "180" | "fliph" | "flipv";
  crf?: number;
  upscaleRes?: "1920x1080" | "1280x720" | "3840x2160";
  targetFps?: number;
  gifFps?: number;
  gifWidth?: number;
  thumbAt?: number;
  colorPreset?: string;
  brightness2?: number;
  contrast2?: number;
  saturation2?: number;
  gamma2?: number;
}

/**
 * Professional cinema-grade colour presets.
 * All presets follow the order: denoise → colour → sharpen.
 */
const COLOR_PRESETS: Record<string, string> = {
  vivid:    "eq=contrast=1.25:saturation=1.55:brightness=0.04:gamma=0.95,unsharp=5:5:0.6:3:3:0.3",
  cinema:   "eq=contrast=1.12:saturation=0.88:gamma=1.08,curves=r='0/0.02 0.5/0.47 1/0.91':g='0/0 0.5/0.49 1/0.97':b='0/0.05 0.5/0.52 1/1',vignette=PI/5",
  warm:     "eq=contrast=1.08:saturation=1.35:brightness=0.02,curves=r='0/0.04 0.5/0.56 1/0.98':g='0/0 0.5/0.51 1/0.97':b='0/0 0.5/0.44 1/0.88'",
  cool:     "eq=contrast=1.06:saturation=1.12:brightness=0.01,curves=r='0/0 0.5/0.44 1/0.88':g='0/0 0.5/0.5 1/0.97':b='0/0.04 0.5/0.56 1/1'",
  vintage:  "eq=contrast=0.92:saturation=0.65:brightness=0.05,curves=r='0/0.06 0.5/0.54 1/0.9':g='0/0.02 0.5/0.5 1/0.87':b='0/0.08 0.5/0.52 1/0.82',vignette=PI/3.2",
  bw:       "hue=s=0,eq=contrast=1.18:brightness=0.02,curves=all='0/0 0.2/0.14 0.5/0.5 0.82/0.88 1/1'",
  dramatic: "eq=contrast=1.38:saturation=0.72:gamma=0.87,curves=all='0/0 0.28/0.2 0.72/0.8 1/1',vignette=PI/3.2",
  soft:     "eq=contrast=0.9:saturation=1.18:brightness=0.05,curves=all='0/0.03 0.5/0.52 1/0.97',unsharp=7:7:0.4:5:5:0.2",
  neon:     "eq=contrast=1.28:saturation=2.2:brightness=-0.03:gamma=0.92,curves=r='0/0.02 0.5/0.62 1/1':b='0/0.08 0.5/0.6 1/1'",
};

/** High-quality x264 encode with film tuning and fast-start. */
function encodeArgs(crf = 19, tune = "film"): string[] {
  return [
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", String(crf),
    "-tune", tune,
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-c:a", "copy",
  ];
}

export function buildFFmpegArgs(
  mode: string,
  settings: EnhanceSettings,
  inFile: string,
  outFile: string,
): string[] {
  const base = ["-y", "-i", inFile];

  /* ── Manual enhance: denoise → colour → sharpen ── */
  if (mode === "enhance") {
    const vf: string[] = [];
    const b = settings.brightness ?? 0;
    const c = settings.contrast ?? 1;
    const s = settings.saturation ?? 1;
    const g = settings.gamma ?? 1;
    if (settings.denoiseFilter === "hqdn3d")
      vf.push("hqdn3d=4:3:6:4.5");
    else if (settings.denoiseFilter === "nlmeans")
      vf.push("hqdn3d=6:5:8:6,atadenoise=0d=8:1d=8:2d=8:s=9");
    vf.push(`eq=brightness=${b}:contrast=${c}:saturation=${s}:gamma=${g}`);
    const sh = settings.sharpness ?? 0;
    if (sh > 0) vf.push(`unsharp=5:5:${sh.toFixed(2)}:3:3:${(sh * 0.4).toFixed(2)}`);
    return [...base, "-vf", vf.join(","), ...encodeArgs(settings.crf ?? 19), outFile];
  }

  /* ── Auto-enhance: fully automatic multi-stage pipeline ── */
  if (mode === "auto-enhance") {
    const level = settings.autoLevel ?? "balanced";
    const vf: string[] = [];

    if (level === "light") {
      vf.push(
        "hqdn3d=2.5:1.5:3.5:3",
        "eq=brightness=0.025:contrast=1.07:saturation=1.18:gamma=0.97",
        "unsharp=5:5:0.45:3:3:0.2",
      );
    } else if (level === "strong") {
      vf.push(
        "hqdn3d=5:4:8:6",
        "atadenoise=0d=8:1d=8:2d=8:s=9",
        "eq=brightness=0.05:contrast=1.16:saturation=1.42:gamma=0.91",
        "curves=all='0/0 0.3/0.26 0.7/0.75 1/1'",
        "unsharp=7:7:1.0:5:5:0.5",
      );
    } else {
      // Balanced — flagship "WOW" mode
      vf.push(
        "hqdn3d=3.5:2.5:5:4",
        "atadenoise=0d=5:1d=5:2d=5:s=9",
        "eq=brightness=0.04:contrast=1.12:saturation=1.32:gamma=0.93",
        "curves=all='0/0 0.28/0.24 0.72/0.76 1/1'",
        "unsharp=5:5:0.85:3:3:0.4",
      );
    }

    return [
      ...base,
      "-vf", vf.join(","),
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", level === "strong" ? "17" : level === "balanced" ? "19" : "21",
      "-tune", "film",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      outFile,
    ];
  }

  /* ── Denoise: spatial + temporal multi-pass ── */
  if (mode === "denoise") {
    const map: Record<string, string> = {
      light:  "hqdn3d=2.5:1.5:3.5:3,unsharp=3:3:0.3:2:2:0.1",
      medium: "hqdn3d=4.5:3.5:7:5.5,atadenoise=0d=5:1d=5:2d=5:s=9,unsharp=3:3:0.2",
      strong: "hqdn3d=7:6:12:9,atadenoise=0d=12:1d=12:2d=12:s=9,unsharp=3:3:0.15",
    };
    const f = map[settings.denoiseStrength ?? "medium"];
    return [...base, "-vf", f, ...encodeArgs(19), outFile];
  }

  /* ── Compress: film-tuned x264 ── */
  if (mode === "compress") {
    return [
      ...base,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", String(settings.crf ?? 26),
      "-tune", "film",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "160k",
      outFile,
    ];
  }

  /* ── Upscale: Lanczos + post-sharpening + subtle colour lift ── */
  if (mode === "upscale") {
    const res = settings.upscaleRes ?? "1920x1080";
    const [w, h] = res.split("x");
    const vf = [
      `scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_inp`,
      "unsharp=5:5:0.7:3:3:0.3",
      "eq=brightness=0.02:contrast=1.06:saturation=1.1",
    ].join(",");
    return [...base, "-vf", vf, ...encodeArgs(18), outFile];
  }

  /* ── Trim ── */
  if (mode === "trim") {
    const start = settings.trimStart ?? 0;
    const end   = settings.trimEnd ?? 10;
    const dur   = Math.max(0.1, end - start);
    return [
      "-y", "-ss", String(start), "-i", inFile, "-t", String(dur),
      "-c:v", "libx264", "-preset", "fast", "-crf", "19",
      "-tune", "film", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      outFile,
    ];
  }

  /* ── Speed change ── */
  if (mode === "speed") {
    const spd    = settings.speed ?? 1;
    const atempo = Math.max(0.5, Math.min(2, spd));
    return [
      ...base,
      "-filter_complex",
      `[0:v]setpts=${(1 / spd).toFixed(4)}*PTS[v];[0:a]atempo=${atempo}[a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "fast", "-crf", "19",
      "-tune", "film", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      outFile,
    ];
  }

  /* ── Rotate / flip ── */
  if (mode === "rotate") {
    const filterMap: Record<string, string> = {
      "90cw":  "transpose=1",
      "90ccw": "transpose=2",
      "180":   "transpose=2,transpose=2",
      fliph:   "hflip",
      flipv:   "vflip",
    };
    const f = filterMap[settings.rotateDir ?? "90cw"] ?? "transpose=1";
    return [...base, "-vf", f, ...encodeArgs(), outFile];
  }

  /* ── Crop ── */
  if (mode === "crop") {
    return [...base, "-vf", "crop=iw*0.8:ih*0.8:iw*0.1:ih*0.1", ...encodeArgs(), outFile];
  }

  /* ── FPS change ── */
  if (mode === "fps") {
    return [...base, "-filter:v", `fps=${settings.targetFps ?? 30}`, ...encodeArgs(), outFile];
  }

  /* ── Extract audio — loudnorm normalised MP3 ── */
  if (mode === "extract-audio") {
    return [
      "-y", "-i", inFile, "-vn",
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-acodec", "libmp3lame", "-q:a", "0",
      outFile,
    ];
  }

  /* ── Remove audio ── */
  if (mode === "remove-audio") {
    return [
      ...base,
      "-c:v", "libx264", "-preset", "fast", "-crf", "19",
      "-tune", "film", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-an", outFile,
    ];
  }

  /* ── GIF: Lanczos + Floyd-Steinberg dithering ── */
  if (mode === "gif") {
    const fps = settings.gifFps ?? 12;
    const w   = settings.gifWidth ?? 480;
    return [
      ...base,
      "-vf",
      `fps=${fps},scale=${w}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle`,
      outFile,
    ];
  }

  /* ── Thumbnail: best quality single frame ── */
  if (mode === "thumbnail") {
    return ["-y", "-ss", String(settings.thumbAt ?? 2), "-i", inFile, "-frames:v", "1", "-q:v", "1", outFile];
  }

  /* ── Colour grade: professional presets or custom ── */
  if (mode === "color-grade") {
    const preset = settings.colorPreset && COLOR_PRESETS[settings.colorPreset];
    const b = settings.brightness2 ?? 0;
    const c = settings.contrast2 ?? 1;
    const s = settings.saturation2 ?? 1;
    const g = settings.gamma2 ?? 1;
    const customFilter = `eq=brightness=${b}:contrast=${c}:saturation=${s}:gamma=${g}`;
    const vf = preset ? preset : customFilter;
    return [...base, "-vf", vf, ...encodeArgs(18), outFile];
  }

  /* ── Stabilise: high-quality vidstabtransform ── */
  if (mode === "stabilize") {
    return [
      ...base,
      "-vf",
      "vidstabtransform=smoothing=30:crop=black:zoom=2:optzoom=1,unsharp=5:5:0.5:3:3:0.3",
      ...encodeArgs(19),
      outFile,
    ];
  }

  /* ── Fingerprint (metadata + noise injection) ── */
  if (mode === "fingerprint") {
    const s = settings as any;
    const method: string          = s.method ?? "all";
    const crfVariance: number     = s.crfVariance ?? 22;
    const noiseLevel: number      = Math.max(1, Math.min(5, s.noiseLevel ?? 1));
    const newTitle: string        = s.newTitle ?? "";
    const newArtist: string       = s.newArtist ?? "";
    const newComment: string      = s.newComment ?? "Processed";
    const changeTimestamp: boolean = s.changeTimestamp !== false;
    const addSubtle: boolean      = s.addSubtle !== false;

    const args: string[] = ["-y", "-i", inFile, "-map_metadata", "-1"];
    if (newTitle)  args.push("-metadata", `title=${newTitle}`);
    if (newArtist) args.push("-metadata", `artist=${newArtist}`);
    if (newComment) args.push("-metadata", `comment=${newComment}`);
    if (changeTimestamp) {
      const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z/, "");
      args.push("-metadata", `creation_time=${now}`);
    }
    const vf: string[] = [];
    if (method !== "strip-meta" && (addSubtle || method === "noise-inject")) {
      vf.push(`noise=alls=${noiseLevel}:allf=t+u`);
    }
    if (vf.length > 0) args.push("-vf", [...new Set(vf)].join(","));
    if (method === "strip-meta") {
      args.push("-c", "copy");
    } else {
      args.push("-c:v", "libx264", "-crf", String(crfVariance), "-preset", "veryfast");
      args.push("-c:a", "aac", "-b:a", "128k");
    }
    args.push("-movflags", "+faststart", outFile);
    return args;
  }

  /* ── Fallback: balanced auto-enhance ── */
  return [
    ...base,
    "-vf",
    "hqdn3d=3.5:2.5:5:4,atadenoise=0d=5:1d=5:2d=5:s=9,eq=brightness=0.04:contrast=1.12:saturation=1.32:gamma=0.93,curves=all='0/0 0.28/0.24 0.72/0.76 1/1',unsharp=5:5:0.85:3:3:0.4",
    ...encodeArgs(19),
    outFile,
  ];
}

export function outputExtForMode(mode: string): string {
  if (mode === "extract-audio") return "mp3";
  if (mode === "gif") return "gif";
  if (mode === "thumbnail") return "jpg";
  return "mp4";
}

export function mimeForExt(ext: string): string {
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "video/mp4";
}
