import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

dotenv.config();
const app = express();
const execFileAsync = promisify(execFile);
const PORT = process.env.PORT || 3000;
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 100);
const upload = multer({ dest: path.join(os.tmpdir(), "avt-uploads"), limits: { fileSize: MAX_MB * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

function sendError(res, err) {
  console.error(err);
  res.status(500).json({ error: err?.message || "Server error" });
}

async function extractAudio(input, output) {
  await execFileAsync("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", output]);
}

async function groqRequest(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, ...(options.headers || {}) }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || `Groq API error (${r.status})`);
  return data;
}

async function processWithGroq(audioPath) {
  if (!process.env.GROQ_API_KEY) throw new Error("Render Environment မှာ GROQ_API_KEY မထည့်ရသေးပါ။");
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
    method: "POST",
    body: form
  });

  const raw = (transcript.segments || []).map(s => ({
    start: s.start, end: s.end, orig: (s.text || "").trim(), text: ""
  }));
  if (!raw.length && transcript.text) {
    raw.push({ start: 0, end: 0, orig: transcript.text.trim(), text: "" });
  }
  if (!raw.length) throw new Error("အသံထဲမှ စကားပြောစာသား မတွေ့ပါ။");

  const translated = [];
  const batchSize = 18;
  for (let i = 0; i < raw.length; i += batchSize) {
    const batch = raw.slice(i, i + batchSize);
    const data = await groqRequest("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
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
    catch { throw new Error("Groq မှ ဘာသာပြန်ရလဒ် JSON မမှန်ကန်ပါ။ ထပ်စမ်းပါ။"); }
    const out = Array.isArray(parsed) ? parsed : parsed.segments;
    if (!Array.isArray(out)) throw new Error("Groq မှ ဘာသာပြန်စာသား မရရှိပါ။");
    translated.push(...out);
  }
  return translated;
}

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  providers: { groq: !!process.env.GROQ_API_KEY }
}));

app.post("/api/process", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ဗီဒီယိုဖိုင် ရွေးချယ်ပါ။" });
  const tempAudio = req.file.path + ".mp3";
  try {
    await extractAudio(req.file.path, tempAudio);
    const provider = req.body.provider || "groq";
    if (provider !== "groq") throw new Error("ယခု အခမဲ့ဗားရှင်းတွင် Groq ကိုသာ ရွေးချယ်ပါ။");
    const segments = await processWithGroq(tempAudio);
    res.json({ segments });
  } catch (e) { sendError(res, e); }
  finally {
    await fs.rm(req.file.path, { force: true });
    await fs.rm(tempAudio, { force: true });
  }
});

app.listen(PORT, () => console.log(`Auto Video Translator PRO running on port ${PORT}`));

