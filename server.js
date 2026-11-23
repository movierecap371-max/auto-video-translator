import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EdgeTTS } from "node-edge-tts";

dotenv.config();

const app = express();
const execFileAsync = promisify(execFile);
const PORT = process.env.PORT || 3000;
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 100);
const uploadDir = path.join(os.tmpdir(), "avt-uploads");
fsSync.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(express.static("public"));

function sendError(res, err) {
  console.error(err);
  res.status(500).json({ error: err?.message || "Server error" });
}

function getVoice(voice) {
  return voice === "male" ? "my-MM-ThihaNeural" : "my-MM-NilarNeural";
}

async function makeSpeech(text, outPath, voice = "female") {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("အသံထုတ်ရန် စာသားမရှိပါ။");
  if (clean.length > 1500) throw new Error("စာကြောင်းတစ်ကြောင်းသည် စာလုံး ၁၅၀၀ ကျော်နေပါသည်။");
  const tts = new EdgeTTS({
    voice: getVoice(voice),
    lang: "my-MM",
    outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    timeout: 60000
  });
  await tts.ttsPromise(clean, outPath);
  const stat = await fs.stat(outPath);
  if (!stat.size) throw new Error("Edge TTS မှ အသံဖိုင်မရရှိပါ။");
}

async function extractAudio(input, output) {
  await execFileAsync("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", output]);
}

async function groqRequest(url, options = {}) {
  if (!process.env.GROQ_API_KEY) throw new Error("Render Environment မှာ GROQ_API_KEY မရှိပါ။");
  const r = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, ...(options.headers || {}) }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || `Groq API error (${r.status})`);
  return data;
}

async function processWithGroq(audioPath) {
  const bytes = await fs.readFile(audioPath);
  if (bytes.length > 24 * 1024 * 1024) {
    throw new Error("အသံဖိုင်သည် 24MB ကျော်နေပါသည်။ ပိုတိုသောဗီဒီယိုကို စမ်းပါ။");
  }
  const form = new FormData();
  form.append("file", new Blob([bytes]), "audio.mp3");
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  const transcript = await groqRequest("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST", body: form
  });

  const raw = (transcript.segments || []).map(s => ({
    start: s.start, end: s.end, orig: (s.text || "").trim(), text: ""
  }));
  if (!raw.length && transcript.text) raw.push({ start: 0, end: 0, orig: transcript.text.trim(), text: "" });
  if (!raw.length) throw new Error("အသံထဲမှ စကားပြောစာသား မတွေ့ပါ။");

  const translated = [];
  const batchSize = 18;
  for (let i = 0; i < raw.length; i += batchSize) {
    const batch = raw.slice(i, i + batchSize);
    const data = await groqRequest("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Translate each movie narration segment into natural, concise spoken Burmese. Preserve the order and exact start/end timestamps. Return only JSON in this shape: {\"segments\":[{\"start\":0,\"end\":1,\"orig\":\"original\",\"text\":\"မြန်မာဘာသာပြန်\"}]}. Keep every input segment; do not add explanations."
          },
          { role: "user", content: JSON.stringify({ segments: batch }) }
        ]
      })
    });
    const content = data.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { throw new Error("Groq မှ ဘာသာပြန်ရလဒ် JSON မမှန်ကန်ပါ။"); }
    const out = Array.isArray(parsed) ? parsed : parsed.segments;
    if (!Array.isArray(out)) throw new Error("Groq မှ ဘာသာပြန်စာသား မရရှိပါ။");
    translated.push(...out);
  }
  return translated;
}

function srtTime(seconds) {
  let ms = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const h = Math.floor(ms / 3600000); ms %= 3600000;
  const m = Math.floor(ms / 60000); ms %= 60000;
  const s = Math.floor(ms / 1000); ms %= 1000;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}
function srtEscape(s) {
  return String(s || "").replace(/\r/g, "").replace(/-->/g, "→");
}

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  providers: { groq: !!process.env.GROQ_API_KEY, edgeTts: true },
  features: { speech: true, mp4Export: true, ffmpeg: true }
}));

app.post("/api/tts", async (req, res) => {
  const tmp = path.join(os.tmpdir(), `avt-tts-${randomUUID()}.mp3`);
  try {
    await makeSpeech(req.body?.text, tmp, req.body?.voice || "female");
    res.type("audio/mpeg");
    res.sendFile(tmp, async err => { await fs.rm(tmp, { force: true }); if (err) console.error(err); });
  } catch (e) {
    await fs.rm(tmp, { force: true });
    sendError(res, e);
  }
});

app.post("/api/process", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ဗီဒီယိုဖိုင် ရွေးချယ်ပါ။" });
  const tempAudio = req.file.path + ".mp3";
  try {
    await extractAudio(req.file.path, tempAudio);
    if ((req.body.provider || "groq") !== "groq") throw new Error("ယခုဗားရှင်းတွင် Groq ကိုသာ အသုံးပြုပါ။");
    const segments = await processWithGroq(tempAudio);
    res.json({ segments });
  } catch (e) { sendError(res, e); }
  finally {
    await fs.rm(req.file.path, { force: true });
    await fs.rm(tempAudio, { force: true });
  }
});

app.post("/api/render", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ဗီဒီယိုဖိုင် ရွေးချယ်ပါ။" });
  const work = path.join(os.tmpdir(), `avt-render-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  const output = path.join(work, "translated-video.mp4");
  try {
    let segments;
    try { segments = JSON.parse(req.body.segments || "[]"); }
    catch { throw new Error("စာတန်းအချက်အလက် မမှန်ကန်ပါ။"); }
    if (!Array.isArray(segments) || !segments.length) throw new Error("ဘာသာပြန်စာတန်း မရှိသေးပါ။");
    if (segments.length > 120) throw new Error("တစ်ကြိမ်လျှင် စာတန်း ၁၂၀ ကြောင်းအထိသာ MP4 ထုတ်နိုင်ပါသည်။");
    const voice = req.body.voice || "female";
    const audioFiles = [];
    const valid = segments.filter(s => String(s.text || "").trim());
    if (!valid.length) throw new Error("မြန်မာဘာသာပြန်စာသား မရှိပါ။");

    for (let i = 0; i < valid.length; i++) {
      const audioPath = path.join(work, `voice-${i}.mp3`);
      await makeSpeech(valid[i].text, audioPath, voice);
      audioFiles.push({ path: audioPath, start: Math.max(0, Number(valid[i].start) || 0) });
    }

    const srt = valid.map((s, i) =>
      `${i + 1}\n${srtTime(s.start)} --> ${srtTime(Math.max(Number(s.end) || (Number(s.start) + 2), Number(s.start) + 0.5))}\n${srtEscape(s.text)}\n`
    ).join("\n");
    const srtPath = path.join(work, "burmese-subtitles.srt");
    await fs.writeFile(srtPath, "\ufeff" + srt, "utf8");

    const args = ["-y", "-i", req.file.path];
    for (const item of audioFiles) args.push("-i", item.path);
    args.push("-i", srtPath);

    const n = audioFiles.length;
    const filters = [];
    const mixInputs = [];
    for (let i = 0; i < n; i++) {
      const delay = Math.round(audioFiles[i].start * 1000);
      filters.push(`[${i + 1}:a]adelay=${delay}|${delay},volume=1[a${i}]`);
      mixInputs.push(`[a${i}]`);
    }
    filters.push(`${mixInputs.join("")}amix=inputs=${n}:duration=longest:dropout_transition=0,apad[aout]`);
    const subtitleInputIndex = n + 1;
    const probe = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", req.file.path
    ]);
    const videoDuration = Math.max(1, Number.parseFloat(probe.stdout.trim()) || 1);
    args.push(
      "-filter_complex", filters.join(";"),
      "-map", "0:v:0", "-map", "[aout]", "-map", `${subtitleInputIndex}:0`,
      "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-c:s", "mov_text",
      "-metadata:s:s:0", "language=bur",
      "-movflags", "+faststart", "-t", String(videoDuration), output
    );
    await execFileAsync("ffmpeg", args, { maxBuffer: 10 * 1024 * 1024 });
    res.download(output, "translated-burmese-video.mp4", async () => {
      await fs.rm(req.file.path, { force: true });
      await fs.rm(work, { recursive: true, force: true });
    });
  } catch (e) {
    await fs.rm(req.file.path, { force: true });
    await fs.rm(work, { recursive: true, force: true });
    sendError(res, e);
  }
});

app.listen(PORT, () => console.log(`Auto Video Translator PRO running on port ${PORT}`));
