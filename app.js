const $=id=>document.getElementById(id);
let file=null,url=null,segments=[],installPrompt=null;
function status(s){$("status").style.display="block";$("status").textContent=s}
$("videoFile").addEventListener("change",e=>{file=e.target.files[0];if(!file)return;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(file);$("player").src=url;segments=[];render();});
$("processBtn").onclick=async()=>{
 if(!file)return status("ဗီဒီယိုဖိုင်ကို အရင်ရွေးချယ်ပါ။");
 const b=$("processBtn");b.disabled=true;b.textContent="လုပ်ဆောင်နေပါသည်...";
 try{const fd=new FormData();fd.append("video",file);fd.append("provider",$("provider").value);
 const r=await fetch("/api/process",{method:"POST",body:fd});const d=await r.json();if(!r.ok)throw Error(d.error||"Processing error");
 segments=d.segments||[];render();status(`ပြီးပါပြီ။ စာတန်း ${segments.length} ကြောင်း ရရှိပါသည်။`);
 }catch(e){status("အမှား: "+e.message)}finally{b.disabled=false;b.textContent="✨ AI ဘာသာပြန်မည်";}
};
function render(){ $("count").textContent=segments.length;$("segments").innerHTML="";
 segments.forEach((s,i)=>{const el=document.createElement("div");el.className="segment";
 const meta=document.createElement("small");meta.textContent=`${fmt(s.start)} – ${fmt(s.end)} | ${s.orig||""}`;
 const ta=document.createElement("textarea");ta.value=s.text||"";ta.addEventListener("input",()=>segments[i].text=ta.value);
 const play=document.createElement("button");play.className="secondary";play.textContent="ဒီစာကြောင်း အသံထွက်";play.onclick=()=>tts(s.text);
 el.append(meta,ta,play);$("segments").append(el);});
}
function fmt(sec){sec=Number(sec)||0;return `${String(Math.floor(sec/60)).padStart(2,"0")}:${(sec%60).toFixed(1).padStart(4,"0")}`}
function srtTime(sec){let ms=Math.round(sec*1000),h=Math.floor(ms/3600000);ms%=3600000;let m=Math.floor(ms/60000);ms%=60000;let s=Math.floor(ms/1000);ms%=1000;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`}
$("srtBtn").onclick=()=>{if(!segments.length)return status("စာတန်းမရှိသေးပါ။");const txt=segments.map((s,i)=>`${i+1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text||""}\n`).join("\n");download(new Blob(["\ufeff"+txt],{type:"text/plain;charset=utf-8"}),"burmese-subtitles.srt")};
$("saveBtn").onclick=()=>download(new Blob([JSON.stringify({file:file?.name,segments},null,2)],{type:"application/json"}),"translator-project.json");
$("playVoiceBtn").onclick=()=>{let i=0;const next=()=>{if(i<segments.length)tts(segments[i++].text).then(next)};next()};
async function tts(text){if(!text?.trim())return;try{const r=await fetch("/api/tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,provider:$("provider").value,voice:$("voice").value})});const d=await r.json();if(!r.ok)throw Error(d.error);const raw=atob(d.audioBase64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 let blob;if(d.mimeType.includes("pcm")){blob=pcmWav(bytes.buffer,24000)}else blob=new Blob([bytes],{type:d.mimeType});const audio=new Audio(URL.createObjectURL(blob));await audio.play();await new Promise(resolve=>audio.onended=resolve);
 }catch(e){status("အသံထွက်အမှား: "+e.message)}}
function pcmWav(pcm,rate){const b=new ArrayBuffer(44+pcm.byteLength),v=new DataView(b);const str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));str(0,"RIFF");v.setUint32(4,36+pcm.byteLength,true);str(8,"WAVE");str(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,"data");v.setUint32(40,pcm.byteLength,true);new Uint8Array(b,44).set(new Uint8Array(pcm));return new Blob([b],{type:"audio/wav"})}
function download(blob,name){const a=document.createElement("a"),u=URL.createObjectURL(blob);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),2000)}
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;$("installBtn").hidden=false});
$("installBtn").onclick=async()=>{if(installPrompt){installPrompt.prompt();installPrompt=null}};
