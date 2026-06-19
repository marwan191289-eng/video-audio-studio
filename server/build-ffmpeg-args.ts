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

const COLOR_PRESETS: Record<string, string> = {
  vivid: "eq=contrast=1.2:saturation=1.5:brightness=0.05",
  cinema:
    "eq=contrast=1.15:saturation=0.85:gamma=1.1,curves=r='0/0 0.5/0.45 1/0.9':g='0/0 0.5/0.5 1/1':b='0/0.05 0.5/0.5 1/1'",
  warm: "eq=contrast=1.05:saturation=1.3",
  cool: "eq=contrast=1.05:saturation=1.1",
  vintage:
    "eq=contrast=0.9:saturation=0.7:brightness=0.05,curves=r='0/0.05 1/0.9':g='0/0.02 1/0.88':b='0/0.06 1/0.82'",
  bw: "hue=s=0,eq=contrast=1.1",
  dramatic: "eq=contrast=1.4:saturation=0.8:gamma=0.9",
  soft: "eq=contrast=0.95:saturation=1.1:brightness=0.03,unsharp=3:3:0.5",
  neon: "eq=contrast=1.3:saturation=2:brightness=-0.05",
};

function encodeArgs(crf = 20): string[] {
  return ["-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-movflags", "+faststart", "-c:a", "copy"];
}

export function buildFFmpegArgs(
  mode: string,
  settings: EnhanceSettings,
  inFile: string,
  outFile: string,
): string[] {
  const base = ["-y", "-i", inFile];

  if (mode === "enhance") {
    const vf: string[] = [];
    const b = settings.brightness ?? 0;
    const c = settings.contrast ?? 1;
    const s = settings.saturation ?? 1;
    const g = settings.gamma ?? 1;
    vf.push(`eq=brightness=${b}:contrast=${c}:saturation=${s}:gamma=${g}`);
    if ((settings.sharpness ?? 0) > 0)
      vf.push(`unsharp=5:5:${(settings.sharpness ?? 0).toFixed(2)}`);
    if (settings.denoiseFilter === "hqdn3d") vf.push("hqdn3d=4:3:6:4.5");
    else if (settings.denoiseFilter === "nlmeans") vf.push("hqdn3d=6:5:8:6");
    return [...base, "-vf", vf.join(","), ...encodeArgs(settings.crf), outFile];
  }

  if (mode === "auto-enhance") {
    const level = settings.autoLevel ?? "balanced";
    const vf: string[] = [];
    if (level === "light") {
      vf.push(
        "hqdn3d=2:1:3:2.5",
        "eq=brightness=0.02:contrast=1.05:saturation=1.15:gamma=0.97",
        "unsharp=3:3:0.3",
      );
    } else if (level === "strong") {
      vf.push(
        "hqdn3d=4:3:6:4.5",
        "eq=brightness=0.05:contrast=1.15:saturation=1.4:gamma=0.92",
        "unsharp=5:5:0.8",
      );
    } else {
      vf.push(
        "hqdn3d=3:2:4:3.5",
        "eq=brightness=0.03:contrast=1.1:saturation=1.25:gamma=0.95",
        "unsharp=5:5:0.5",
      );
    }
    return [
      ...base,
      "-vf", vf.join(","),
      "-c:v", "libx264", "-preset", "fast",
      "-crf", level === "strong" ? "18" : level === "balanced" ? "20" : "22",
      "-movflags", "+faststart",
      "-c:a", "copy",
      outFile,
    ];
  }

  if (mode === "denoise") {
    const map = {
      light: "hqdn3d=2:1:3:2.5",
      medium: "hqdn3d=4:3:6:4.5",
      strong: "hqdn3d=6:5:10:7",
    };
    const f = map[settings.denoiseStrength ?? "medium"];
    return [...base, "-vf", f, ...encodeArgs(), outFile];
  }

  if (mode === "compress") {
    return [
      ...base,
      "-c:v", "libx264", "-preset", "medium",
      "-crf", String(settings.crf ?? 28),
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "128k",
      outFile,
    ];
  }

  if (mode === "upscale") {
    const res = settings.upscaleRes ?? "1920x1080";
    const [w, h] = res.split("x");
    return [...base, "-vf", `scale=${w}:${h}:flags=bilinear`, ...encodeArgs(), outFile];
  }

  if (mode === "trim") {
    const start = settings.trimStart ?? 0;
    const end = settings.trimEnd ?? 10;
    const dur = Math.max(0.1, end - start);
    return ["-y", "-ss", String(start), "-i", inFile, "-t", String(dur), "-c", "copy", outFile];
  }

  if (mode === "speed") {
    const spd = settings.speed ?? 1;
    const atempo = Math.max(0.5, Math.min(2, spd));
    return [
      ...base,
      "-filter_complex",
      `[0:v]setpts=${(1 / spd).toFixed(4)}*PTS[v];[0:a]atempo=${atempo}[a]`,
      "-map", "[v]",
      "-map", "[a]",
      "-c:v", "libx264", "-preset", "fast", "-crf", "20",
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "128k",
      outFile,
    ];
  }

  if (mode === "rotate") {
    const filterMap: Record<string, string> = {
      "90cw": "transpose=1",
      "90ccw": "transpose=2",
      "180": "transpose=2,transpose=2",
      fliph: "hflip",
      flipv: "vflip",
    };
    const f = filterMap[settings.rotateDir ?? "90cw"] ?? "transpose=1";
    return [...base, "-vf", f, ...encodeArgs(), outFile];
  }

  if (mode === "crop") {
    return [...base, "-vf", "crop=iw*0.8:ih*0.8:iw*0.1:ih*0.1", ...encodeArgs(), outFile];
  }

  if (mode === "fps") {
    return [...base, "-filter:v", `fps=${settings.targetFps ?? 30}`, ...encodeArgs(), outFile];
  }

  if (mode === "extract-audio") {
    return ["-y", "-i", inFile, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outFile];
  }

  if (mode === "remove-audio") {
    return [...base, "-c:v", "copy", "-an", outFile];
  }

  if (mode === "gif") {
    const fps = settings.gifFps ?? 10;
    const w = settings.gifWidth ?? 480;
    return [
      ...base,
      "-vf",
      `fps=${fps},scale=${w}:-1:flags=bilinear,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`,
      outFile,
    ];
  }

  if (mode === "thumbnail") {
    return ["-y", "-ss", String(settings.thumbAt ?? 2), "-i", inFile, "-frames:v", "1", "-q:v", "2", outFile];
  }

  if (mode === "color-grade") {
    const preset = settings.colorPreset && COLOR_PRESETS[settings.colorPreset];
    const b = settings.brightness2 ?? 0;
    const c = settings.contrast2 ?? 1;
    const s = settings.saturation2 ?? 1;
    const g = settings.gamma2 ?? 1;
    const customFilter = `eq=brightness=${b}:contrast=${c}:saturation=${s}:gamma=${g}`;
    const vfParts = preset ? [preset] : [customFilter];
    return [...base, "-vf", vfParts.join(","), ...encodeArgs(), outFile];
  }

  if (mode === "stabilize") {
    return [
      ...base,
      "-vf",
      "vidstabtransform=smoothing=20,unsharp=3:3:0.5",
      ...encodeArgs(),
      outFile,
    ];
  }

  // fallback: balanced auto-enhance
  return [
    ...base,
    "-vf",
    "hqdn3d=3:2:4:3.5,eq=brightness=0.03:contrast=1.1:saturation=1.25:gamma=0.95,unsharp=5:5:0.5",
    ...encodeArgs(),
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
