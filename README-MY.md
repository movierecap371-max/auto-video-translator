# Auto Video Translator PRO (Android + Website)

ဒီ project သည် Android Chrome တွင် Install လုပ်နိုင်သော PWA နှင့် Online Website အတွက် Starter App ဖြစ်သည်။

## ပါဝင်သောအရာများ
- Responsive Burmese UI
- OpenAI / Gemini provider ရွေးချယ်မှု
- Server-side API key configuration
- Video upload မှ audio extraction (FFmpeg)
- OpenAI transcription + Burmese translation
- Gemini audio transcription + translation
- TTS အသံဖန်တီးခြင်း
- SRT နှင့် Project JSON export
- PWA manifest + service worker

## လိုအပ်ချက်
- Node.js 20+
- FFmpeg ကို server ပေါ်တွင် install လုပ်ထားရန်
- OpenAI နှင့်/သို့ Gemini API key
- HTTPS hosting (PWA install အတွက်)

## Local စတင်ရန်
1. ZIP ကိုဖြည်ပါ။
2. Terminal မှ project folder ထဲဝင်ပါ။
3. `npm install`
4. `.env.example` ကို `.env` အဖြစ်ကူးပြီး API key များထည့်ပါ။
5. `npm start`
6. Browser တွင် `http://localhost:3000` ဖွင့်ပါ။

## Android တွင် Install
Website ကို HTTPS domain ပေါ်တင်ပြီး Android Chrome ဖြင့်ဖွင့်ပါ။ Browser menu မှ "Install app" သို့မဟုတ် "Add to Home screen" ကိုနှိပ်ပါ။

## Hosting
Node.js app နှင့် FFmpeg ပါဝင်သော hosting ကိုသုံးပါ။ ဥပမာ VPS, Render/Fly.io စသည့် persistent Node service။ Hosting ပေါ်တွင် environment variables ထည့်ပါ။ Upload size/time limit များကို hosting အလိုက် ချိန်ညှိပါ။

## လုံခြုံရေး
- API key များကို `.env` ထဲတွင်သာထားပါ။ GitHub သို့မတင်ပါနှင့်။
- `.env` ကို `.gitignore` ထဲထည့်ထားသည်။
- Production တွင် authentication, rate limiting, upload quota, malware scanning, private object storage နှင့် job queue ထပ်ထည့်ပါ။
- User upload များကို server က temporary file အဖြစ်လုပ်ဆောင်ပြီး ပြီးလျှင်ဖျက်သည်။

## လက်ရှိ MVP ကန့်သတ်ချက်
- Server-side video export (burn-in subtitle + dubbed audio mix) ကို မထည့်ရသေးပါ။ ဒီအတွက် FFmpeg rendering worker/job queue ထပ်တည်ဆောက်ရန်လိုသည်။
- Gemini audio inline request သည် အရွယ်အစားကြီးသောဖိုင်များအတွက် မသင့်တော်ပါ။ ကြာရှည်/ကြီးမားသောဗီဒီယိုများအတွက် Gemini Files API သို့ပြောင်းရန်လိုသည်။
- Browser offline mode သည် UI shell အတွက်သာဖြစ်ပြီး AI processing အတွက် internet လိုအပ်သည်။
- AI output ကို အမြဲစစ်ဆေးပြင်ဆင်ပါ။ Timestamp နှင့် မြန်မာအသံထွက် မှားနိုင်သည်။

## API endpoints
- `GET /api/health`
- `POST /api/process` multipart form: `video`, `provider=openai|gemini`
- `POST /api/tts` JSON: `{ "text": "...", "provider": "openai|gemini", "voice": "alloy" }`
