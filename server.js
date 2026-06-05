import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: "uploads/", limits: { fileSize: 500 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("outputs")) fs.mkdirSync("outputs");

app.get("/api/health", (req, res) => res.json({ status: "ok", ffmpeg: !!ffmpegPath }));

app.post("/api/analyse", upload.single("frame"), async (req, res) => {
  try {
    const { format, objective, productInfo } = req.body;
    const frameFile = req.file;
    if (!frameFile) return res.status(400).json({ error: "No frame provided" });
    const imageData = fs.readFileSync(frameFile.path).toString("base64");
    fs.unlinkSync(frameFile.path);

    const sys = `You are the world's leading Meta advertising creative director for fine art. Deep knowledge of Meta algorithm signals, neuromarketing, luxury buyer psychology, Saatchi Art, 1stDibs, Artsy, White Cube competitor strategies, and what converts fine art buyers aged 30-65 in Europe. You also understand video editing for conversion: optimal trim lengths, pacing for art content, and how to structure a 15-30 second video for maximum watch time and click-through.

Return ONLY valid JSON, no markdown, no backticks:
{
  "analysis": "3 sentences on content, emotional hooks, conversion opportunity vs competitors",
  "conversionInsights": "3 sentences on psychological triggers, Meta algorithm strategy, competitor patterns to beat",
  "crop": { "focusX": 0.5, "focusY": 0.38, "note": "string" },
  "colorGrade": { "brightness": 6, "contrast": 14, "saturation": 10, "warmth": 12, "note": "string" },
  "overlay": { "style": "gradient_bottom", "opacity": 0.52, "note": "string" },
  "hook": { "text": "8 words max scroll-stopper", "note": "string" },
  "headline": { "text": "35 chars max collector voice", "position": "bottom", "size": "large", "color": "#ffffff", "style": "serif", "note": "string" },
  "subtext": { "text": "40 chars max price and scarcity", "show": true, "color": "#f5e6c8" },
  "video": {
    "trimTo": 30,
    "fadeInDuration": 0.4,
    "fadeOutDuration": 0.5,
    "hookEndTime": 3.2,
    "textFadeInTime": 0.5,
    "endCardStartOffset": 3.5,
    "endCardText": "10 words max CTA for end card",
    "paceNote": "string explaining trim and pacing rationale"
  },
  "adCopy": {
    "primaryText": "125 chars max emotional plus price plus FOMO",
    "headline": "40 chars max",
    "description": "30 chars max",
    "cta": "SHOP_NOW",
    "variantB": "125 chars max social proof angle",
    "variantC": "125 chars max scarcity angle"
  },
  "audience": {
    "summary": "2 sentences plus competitor overlap strategy",
    "ageRange": "32-65",
    "genders": "All",
    "locations": ["Spain","United Kingdom","Portugal","France","Germany"],
    "interests": ["Fine art","Art collecting","Interior design","Contemporary art","Saatchi Art","Home decor","Luxury goods","Art galleries"],
    "behaviors": ["Engaged shoppers","Luxury item buyers","Frequent international travellers"],
    "customAudiences": ["Website visitors last 30 days","Instagram engagers last 60 days","Video viewers 75%+"],
    "lookalike": "1-2% lookalike of website purchasers",
    "exclusions": ["Existing customers","Bounced visitors under 10 seconds"],
    "estimatedReach": "150,000-400,000",
    "whyThisAudience": "3 sentences"
  },
  "campaign": {
    "budgetDaily": "20-35 euros per day",
    "bidStrategy": "Lowest cost without cap",
    "placements": "Instagram Feed, Stories, Reels, Facebook Feed — exclude Audience Network",
    "schedule": "Tue-Sat 7pm-11pm local time",
    "abTest": "Test primary text A vs C same creative and audience",
    "kpis": { "ctr": ">2.5%", "cpc": "<0.90 euros", "roas": "4-8x after week 3" },
    "week1": ["Days 1-2: Launch at budget, monitor CPM — above 18 euros narrow interests","Day 3: CTR below 1.5% test new primary text","Days 4-5: Best placement increase allocation 30%","Days 6-7: Add 1% lookalike if pixel has 50+ purchase events"]
  }
}`;

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1800,
      system: sys,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageData } },
        { type: "text", text: `Format: ${format}. Objective: ${objective}. Product: ${productInfo || "Original fine art by Marta Mescar, martamescar.com"}. Apply every conversion insight.` }
      ]}]
    });

    const data = JSON.parse(message.content[0].text.replace(/```json|```/g,"").trim());
    res.json(data);
  } catch (e) {
    console.error("Analyse error:", e);
    res.status(500).json({ error: e.message });
  }
});

function safeText(t, max) {
  return (t||"").replace(/[\\':,\[\]]/g," ").replace(/\s+/g," ").trim().substring(0, max||55);
}

function buildFilters(params, fmt, duration, isVideo) {
  const { w, h } = fmt;
  const cg = params.colorGrade || {};
  const br  = ((cg.brightness||0)/100).toFixed(3);
  const con = (1+(cg.contrast||0)/100).toFixed(3);
  const sat = (1+(cg.saturation||0)/100).toFixed(3);
  const wm  = cg.warmth||0;
  const pad    = Math.round(w*0.07);
  const headFs = Math.round(w*0.062);
  const subFs  = Math.round(headFs*0.52);
  const hookFs = Math.round(w*0.072);
  const urlFs  = Math.round(w*0.028);
  const endFs  = Math.round(w*0.055);
  const headY  = h-pad-urlFs-16-subFs-14-headFs;
  const subY   = h-pad-urlFs-16-subFs;
  const urlY   = h-pad;
  const hookText = safeText(params.hook?.text||"");
  const headText = safeText(params.headline?.text||"");
  const subText  = safeText(params.subtext?.text||"");
  const endText  = safeText(params.video?.endCardText||"Shop at martamescar.com");
  const vid = params.video||{};
  const hookEnd  = vid.hookEndTime||3.2;
  const tFadeIn  = vid.textFadeInTime||0.5;
  const endOff   = vid.endCardStartOffset||3.5;
  const endStart = Math.max(0,(duration||30)-endOff);
  const oa = params.overlay?.opacity||0.52;
  const gradY = Math.round(h*0.50);

  const f = [
    // 1. Resize to Meta format
    `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
    // 2. Colour grade
    `eq=brightness=${br}:contrast=${con}:saturation=${sat}`,
    // 3. Warmth via colorchannelmixer (no quoting issues)
    ...(wm>0 ? [`colorchannelmixer=rr=${(1+wm/180).toFixed(3)}:bb=${(1-wm/220).toFixed(3)}`] : []),
    // 4. Gradient overlay via drawbox (works on JPEG, no alpha needed)
    `drawbox=x=0:y=${gradY}:w=iw:h=${h-gradY}:color=black@${oa.toFixed(2)}:t=fill`,
  ];

  // 5. Text overlays
  if (hookText&&isVideo) {
    f.push(`drawtext=text='${hookText}':fontsize=${hookFs}:fontcolor=white:x=(w-text_w)/2:y=${Math.round(h*0.35)}:shadowcolor=black@0.85:shadowx=3:shadowy=3:enable='between(t\\,0\\,${hookEnd})'`);
  }
  if (headText) {
    const en = isVideo ? `:enable='gt(t\\,${tFadeIn})'` : "";
    f.push(`drawtext=text='${headText}':fontsize=${headFs}:fontcolor=white:x=${pad}:y=${headY}:shadowcolor=black@0.75:shadowx=2:shadowy=2${en}`);
  }
  if (subText&&params.subtext?.show!==false) {
    const en = isVideo ? `:enable='gt(t\\,${tFadeIn})'` : "";
    f.push(`drawtext=text='${subText}':fontsize=${subFs}:fontcolor=#f5e6c8:x=${pad}:y=${subY}:shadowcolor=black@0.65:shadowx=1:shadowy=1${en}`);
  }
  f.push(`drawtext=text='martamescar.com':fontsize=${urlFs}:fontcolor=white@0.65:x=${pad}:y=${urlY}:shadowcolor=black@0.5:shadowx=1:shadowy=1`);
  if (isVideo&&endText&&duration>endOff) {
    f.push(`drawtext=text='${endText}':fontsize=${endFs}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.9:shadowx=3:shadowy=3:enable='gte(t\\,${endStart})'`);
  }

  return f.join(",");
}

app.post("/api/process-video", upload.single("video"), (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.status(400).json({ error: "No video provided" });
  let params, fmt;
  try { params=JSON.parse(req.body.params); fmt=JSON.parse(req.body.format); }
  catch(e) { return res.status(400).json({ error:"Invalid params" }); }

  const outputPath = `outputs/edited_${Date.now()}.mp4`;
  const vid = params.video||{};
  const trimTo   = vid.trimTo||30;
  const fadeIn   = vid.fadeInDuration||0.4;
  const fadeOut  = vid.fadeOutDuration||0.5;

  ffmpeg.ffprobe(videoFile.path, (err, meta) => {
    if (err) { try{fs.unlinkSync(videoFile.path);}catch{} return res.status(500).json({error:"Could not read video: "+err.message}); }
    const duration = Math.min(meta.format.duration||30, trimTo);
    const filters  = buildFilters(params, fmt, duration, true);
    const fadeOutStart = Math.max(0, duration-fadeOut);

    ffmpeg(videoFile.path)
      .duration(duration)
      .videoFilters([filters, `fade=t=in:st=0:d=${fadeIn}`, `fade=t=out:st=${fadeOutStart}:d=${fadeOut}`].join(","))
      .fps(30)
      .videoCodec("libx264")
      .addOption("-preset","fast")
      .addOption("-crf","20")
      .addOption("-movflags","+faststart")
      .audioCodec("aac")
      .audioBitrate("128k")
      .audioFilters(`afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutStart}:d=${fadeOut}`)
      .output(outputPath)
      .on("end",()=>{
        res.download(outputPath,"martamescar_ad.mp4",()=>{
          try{fs.unlinkSync(videoFile.path);}catch{}
          try{fs.unlinkSync(outputPath);}catch{}
        });
      })
      .on("error",err=>{
        console.error("FFmpeg:",err.message);
        try{fs.unlinkSync(videoFile.path);}catch{}
        res.status(500).json({error:"Video processing failed: "+err.message});
      })
      .run();
  });
});

app.post("/api/process-image", upload.single("image"), (req, res) => {
  const imgFile = req.file;
  if (!imgFile) return res.status(400).json({ error: "No image provided" });
  let params, fmt;
  try { params=JSON.parse(req.body.params); fmt=JSON.parse(req.body.format); }
  catch(e) { return res.status(400).json({ error:"Invalid params" }); }

  const outputPath = `outputs/edited_${Date.now()}.jpg`;
  const filters = buildFilters(params, fmt, 0, false);

  ffmpeg(imgFile.path)
    .videoFilters(filters)
    .frames(1)
    .output(outputPath)
    .on("end",()=>{
      res.download(outputPath,"martamescar_ad.jpg",()=>{
        try{fs.unlinkSync(imgFile.path);}catch{}
        try{fs.unlinkSync(outputPath);}catch{}
      });
    })
    .on("error",err=>{
      try{fs.unlinkSync(imgFile.path);}catch{}
      res.status(500).json({error:err.message});
    })
    .run();
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`ArtAd Studio on port ${PORT}`));
