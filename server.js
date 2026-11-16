import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

dotenv.config();
const app = express();
const execFileAsync = promisify(execFile);
const PORT = process.env.PORT || 3000;
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 100);
const upload = multer({
  dest: path.join(os.tmpdir(), "avt-uploads"),
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

function sendError(res, err) {
  console.error(err);
  res.status(500).json({ error: err?.message || "Server error" });
}
async function extractAudio(input, output) {
  await execFileAsync("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", output]);
}
async function transcribeOpenAI(audioPath) {
  const form = new FormData();
  const bytes = await fs.readFile(audioPath);
  form.append("file", new Blob([bytes]), "audio.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "OpenAI transcription failed");
  return (data.segments || []).map(s => ({ start: s.start, end: s.end, orig: s.text.trim(), text: "" }));
}
async function translateOpenAI(segments) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Translate each segment into natural spoken Burmese for a movie recap. Preserve order and timestamps. Return JSON: {\"segments\":[{\"start\":0,\"end\":1,\"orig\":\"...\",\"text\":\"...\"}]}" },
        { role: "user", content: JSON.stringify({ segments }) }
      ]
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "OpenAI translation failed");
  return JSON.parse(data.choices[0].message.content).segments;
}
async function processWithGemini(audioPath) {
  const bytes = await fs.readFile(audioPath);
  const b64 = bytes.toString("base64");
  const prompt = `Transcribe this audio and translate every spoken segment into natural spoken Burmese for movie recap dubbing. Include accurate start and end timestamps in seconds. Return only JSON array: [{"start":0.0,"end":2.5,"orig":"original speech","text":"မြန်မာဘာသာပြန်"}]`;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "audio/mpeg", data: b64 } }] }], generationConfig: { response_mime_type: "application/json" } })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "Gemini processing failed");
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.segments;
}

app.get("/api/health", (_req, res) => res.json({ ok: true, providers: { openai: !!process.env.OPENAI_API_KEY, gemini: !!process.env.GEMINI_API_KEY } }));

app.post("/api/process", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ဗီဒီယိုဖိုင် ရွေးချယ်ပါ။" });
  const provider = req.body.provider || "openai";
  const tempAudio = req.file.path + ".mp3";
  try {
    await extractAudio(req.file.path, tempAudio);
    let segments;
    if (provider === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Server ပေါ်တွင် GEMINI_API_KEY မထည့်ရသေးပါ။");
      segments = await processWithGemini(tempAudio);
    } else {
      if (!process.env.OPENAI_API_KEY) throw new Error("Server ပေါ်တွင် OPENAI_API_KEY မထည့်ရသေးပါ။");
      const raw = await transcribeOpenAI(tempAudio);
      segments = await translateOpenAI(raw);
    }
    res.json({ segments });
  } catch (e) { sendError(res, e); }
  finally { await fs.rm(req.file.path, { force: true }); await fs.rm(tempAudio, { force: true }); }
});

app.post("/api/tts", async (req, res) => {
  const { text, provider = "openai", voice = "alloy" } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: "စာသားထည့်ပါ။" });
  try {
    if (provider === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY မရှိပါ။");
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: `Read naturally in Burmese: ${text}` }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } } })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || "Gemini TTS failed");
      const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!part) throw new Error("Gemini မှ အသံဒေတာ မရရှိပါ။");
      res.json({ mimeType: part.inlineData.mimeType || "audio/pcm", audioBase64: part.inlineData.data });
    } else {
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY မရှိပါ။");
      const r = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "tts-1", voice, input: text, response_format: "mp3" })
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || "OpenAI TTS failed"); }
      const buf = Buffer.from(await r.arrayBuffer());
      res.json({ mimeType: "audio/mpeg", audioBase64: buf.toString("base64") });
    }
  } catch (e) { sendError(res, e); }
});

app.listen(PORT, () => console.log(`Auto Video Translator PRO running on http://localhost:${PORT}`));
