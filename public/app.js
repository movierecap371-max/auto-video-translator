file $ = id => document.getElementById(id);
let file = null, url = null, segments = [], installPrompt = null, voice = "female";

function status(s) { $("status").style.display = "block"; $("status").textContent = s; }

$("videoFile").addEventListener("change", e => {
  file = e.target.files[0];
  if (!file) return;
  if (url) URL.revokeObjectURL(url);

url = URL.createObjectURL(file);
  
  $("player").src = uurl
  segments = [];
  render();
});

$("processBtn").onclick = async () => {
  if (!file) return status("ဗီဒီယိုဖိုင်ကို အရင်ရွေးချယ်ပါ။");
  const b = $("processBtn"); b.disabled = true; b.textContent = "လုပ်ဆောင်နေပါသည်...";
  try {
    const fd = new FormData(); fd.append("video", file); fd.append("provider", "groq");
    const r = await fetch("/api/process", { method: "POST", body: fd });
    const d = await r.json(); if (!r.ok) throw Error(d.error || "Processing error");
    segments = d.segments || []; render();
    status(`ပြီးပါပြီ။ စာတန်း ${segments.length} ကြောင်း ရရှိပါသည်။`);
  } catch (e) { status("အမှား: " + e.message); }
  finally { b.disabled = false; b.textContent = "✨ AI ဘာသာပြန်မည်"; }
};

function render() {
  $("count").textContent = segments.length;
  $("segments").innerHTML = "";
  segments.forEach((s, i) => {
    const el = document.createElement("div"); el.className = "segment";
    const meta = document.createElement("small"); meta.textContent = `${fmt(s.start)} – ${fmt(s.end)} | ${s.orig || ""}`;
    const ta = document.createElement("textarea"); ta.value = s.text || "";
    ta.addEventListener("input", () => segments[i].text = ta.value);
    const play = document.createElement("button"); play.className = "secondary";
    play.textContent = "ဒီစာကြောင်း အသံထွက်"; play.onclick = () => speakBurmese(s.text);
    el.append(meta, ta, play); $("segments").append(el);
  });
}
function fmt(sec) {
  sec = Number(sec) || 0;
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${(sec % 60).toFixed(1).padStart(4, "0")}`;
}
function srtTime(sec) {
  let ms = Math.round((Number(sec) || 0) * 1000), h = Math.floor(ms / 3600000);
  ms %= 3600000; let m = Math.floor(ms / 60000); ms %= 60000;
  let s = Math.floor(ms / 1000); ms %= 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
$("srtBtn").onclick = () => {
  if (!segments.length) return status("စာတန်းမရှိသေးပါ။");
  const txt = segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text || ""}\n`).join("\n");
  download(new Blob(["\ufeff" + txt], { type: "text/plain;charset=utf-8" }), "burmese-subtitles.srt");
};
$("saveBtn").onclick = () => download(new Blob([JSON.stringify({ file: file?.name, segments }, null, 2)], { type: "application/json" }), "translator-project.json");

async function speakBurmese(text) {
  if (!text?.trim()) return;
  status("မြန်မာအသံ ဖန်တီးနေပါသည်...");
  try {
    const r = await fetch("/api/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice })
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw Error(d.error || "အသံထုတ်မရပါ။"); }
    
const contentType = r.headers.get("content-type") || "";
if (!contentType.includes("audio/")) {
  const errorText = await r.text();
  throw Error("အသံဖိုင်မဟုတ်ပါ။ Server: " + errorText.slice(0, 200));
}
const blob = await r.blob();
const audioUrl = URL.createObjectURL(blob);
const audio = new Audio(audioUrl);

try {
  await audio.play();
  await new Promise((resolve, reject) => {
    audio.onended = resolve;
    audio.onerror = () => reject(Error("အသံဖွင့်မရပါ။"));
  });
} finally {
  URL.revokeObjectURL(audioUrl);
}
status("အသံဖွင့်ပြီးပါပြီ။");
    
  } catch (e) { status("အသံအမှား: " + e.message); }
}

$("playVoiceBtn").onclick = async () => {
  if (!segments.length) return status("စာတန်းမရှိသေးပါ။");
  for (const s of segments) { if (s.text?.trim()) await speakBurmese(s.text); }
};

function addExportControls() {
  if ($("voiceSelect")) return;
  const host = $("playVoiceBtn")?.parentElement || $("segments")?.parentElement;
  if (!host) return;
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:center";
  const label = document.createElement("label"); label.textContent = "မြန်မာအသံ ";
  const select = document.createElement("select"); select.id = "voiceSelect";
  select.innerHTML = '<option value="female">Nilar (အမျိုးသမီး)</option><option value="male">Thiha (အမျိုးသား)</option>';
  select.addEventListener("change", () => voice = select.value);
  const renderBtn = document.createElement("button"); renderBtn.id = "renderVideoBtn";
  renderBtn.textContent = "🎬 မြန်မာအသံ + စာတန်း MP4 ဒေါင်းလုဒ်";
  renderBtn.addEventListener("click", renderVideo);
  wrap.append(label, select, renderBtn); host.append(wrap);
}
async function renderVideo() {
  if (!file) return status("မူရင်းဗီဒီယိုကို အရင်ရွေးပါ။");
  if (!segments.length) return status("အရင်ဆုံး AI ဘာသာပြန်ပါ။");
  const b = $("renderVideoBtn"); b.disabled = true; b.textContent = "MP4 ဖန်တီးနေပါသည်... ခဏစောင့်ပါ";
  try {
    const fd = new FormData(); fd.append("video", file);
    fd.append("segments", JSON.stringify(segments)); fd.append("voice", voice);
    const r = await fetch("/api/render", { method: "POST", body: fd });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw Error(d.error || "MP4 ဖန်တီးမရပါ။"); }
    const blob = await r.blob();
    download(blob, "translated-burmese-video.mp4");
    status("ပြီးပါပြီ။ MP4 ဖိုင်ကို ဖုန်း Downloads ထဲ သိမ်းပါ။");
  } catch (e) { status("MP4 အမှား: " + e.message); }
  finally { b.disabled = false; b.textContent = "🎬 မြန်မာအသံ + စာတန်း MP4 ဒေါင်းလုဒ်"; }
}
function download(blob, name) {
  const a = document.createElement("a"), u = URL.createObjectURL(blob);
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
addExportControls();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; $("installBtn").hidden = false; });
$("installBtn").onclick = async () => { if (installPrompt) { installPrompt.prompt(); installPrompt = null; } };
