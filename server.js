import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

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

// ─── Claude analysis ────────────────────────────────────────────────────────
app.post("/api/analyse", upload.single("frame"), async (req, res) => {
  try {
    const { format, objective, productInfo } = req.body;
    const frameFile = req.file;
    if (!frameFile) return res.status(400).json({ error: "No frame provided" });
    const imageData = fs.readFileSync(frameFile.path).toString("base64");
    fs.unlinkSync(frameFile.path);

    const isCommission = objective === "OUTCOME_COMMISSION";

    const sys = `You are the world's leading Meta advertising creative director for fine art. Deep knowledge of Meta algorithm signals, neuromarketing, luxury buyer psychology, Saatchi Art, 1stDibs, Artsy, White Cube competitor strategies, and what converts fine art buyers aged 30-65 in Europe.

${isCommission ? `This campaign objective is to generate COMMISSION ENQUIRIES — the goal is to get potential buyers to send a message to enquire about commissioning a custom original painting. Copy should focus on the bespoke experience, the personal connection with the artist, and the unique value of owning a painting made specifically for them. CTA should drive to message or enquire, not a direct purchase. Use LEARN_MORE or SEND_MESSAGE as CTA.` : ""}

Return ONLY valid JSON, no markdown, no backticks:
{
  "analysis": "3 sentences on content, emotional hooks, conversion opportunity",
  "conversionInsights": "3 sentences on psychological triggers, Meta algorithm strategy, what will make this specific audience take action",
  "crop": { "focusX": 0.5, "focusY": 0.38, "note": "string" },
  "colorGrade": { "brightness": 6, "contrast": 14, "saturation": 10, "warmth": 12, "note": "string" },
  "overlay": { "style": "gradient_bottom", "opacity": 0.52, "note": "string" },
  "hook": { "text": "8 words max scroll-stopper", "note": "string" },
  "headline": { "text": "35 chars max", "position": "bottom", "size": "large", "color": "#ffffff", "style": "serif", "note": "string" },
  "subtext": { "text": "${isCommission ? "35 chars — invite to commission e.g. Commission yours · message to enquire" : "40 chars max price and scarcity"}", "show": true, "color": "#f5e6c8" },
  "video": {
    "trimTo": 30,
    "fadeInDuration": 0.4,
    "fadeOutDuration": 0.5,
    "hookEndTime": 3.2,
    "textFadeInTime": 0.5,
    "endCardStartOffset": 3.5,
    "endCardText": "${isCommission ? "10 words — commission CTA e.g. Commission your own original. Message Marta today." : "10 words max CTA for end card"}",
    "paceNote": "string explaining trim and pacing rationale"
  },
  "adCopy": {
    "primaryText": "${isCommission ? "125 chars — emotional story of owning a bespoke original, end with invitation to message" : "125 chars max emotional plus price plus FOMO"}",
    "headline": "40 chars max",
    "description": "30 chars max",
    "cta": "${isCommission ? "LEARN_MORE" : "SHOP_NOW"}",
    "variantB": "${isCommission ? "125 chars — focus on the personal artist relationship and bespoke process" : "125 chars max social proof angle"}",
    "variantC": "${isCommission ? "125 chars — social proof angle, previous collectors who commissioned" : "125 chars max scarcity angle"}"
  },
  "audience": {
    "summary": "2 sentences plus targeting strategy",
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
    "abTest": "Test primary text A vs B same creative and audience",
    "kpis": { "ctr": ">2.5%", "cpc": "<0.90 euros", "roas": "${isCommission ? "measure cost per enquiry — target under 15 euros" : "4-8x after week 3"}" },
    "week1": ["Days 1-2: Launch at budget monitor CPM — above 18 euros narrow interests","Day 3: CTR below 1.5% test new primary text","Days 4-5: Best placement increase allocation 30%","Days 6-7: Add 1% lookalike if pixel has 50+ events"]
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
    console.error("Analyse error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Safe text for drawtext ─────────────────────────────────────────────────
function safeText(t, max) {
  return (t||"").replace(/[\\':,\[\]]/g," ").replace(/\s+/g," ").trim().substring(0, max||55);
}

// ─── Video processing ────────────────────────────────────────────────────────
app.post("/api/process-video", upload.single("video"), (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.status(400).json({ error: "No video provided" });

  let params, fmt;
  try { params=JSON.parse(req.body.params); fmt=JSON.parse(req.body.format); }
  catch(e) { return res.status(400).json({ error: "Invalid params" }); }

  const outputPath = `/tmp/edited_${Date.now()}.mp4`;
  const vid = params.video || {};
  const trimTo   = Math.min(vid.trimTo||30, 35);
  const fadeIn   = vid.fadeInDuration||0.4;
  const fadeOut  = vid.fadeOutDuration||0.5;
  const cg       = params.colorGrade||{};
  const br       = ((cg.brightness||0)/100).toFixed(3);
  const con      = (1+(cg.contrast||0)/100).toFixed(3);
  const sat      = (1+(cg.saturation||0)/100).toFixed(3);
  const { w, h } = fmt;
  const gradY    = Math.round(h*0.50);
  const oa       = params.overlay?.opacity||0.52;

  console.log(`[Video] Starting: ${videoFile.path}, trim: ${trimTo}s, format: ${w}x${h}`);

  ffmpeg.ffprobe(videoFile.path, (err, meta) => {
    if (err) {
      console.error("[Video] Probe error:", err.message);
      try{fs.unlinkSync(videoFile.path);}catch{}
      return res.status(500).json({ error: "Could not read video: " + err.message });
    }

    const duration    = Math.min(meta.format.duration||30, trimTo);
    const fadeOutStart = Math.max(0, duration - fadeOut);

    // Minimal filter chain — only universally available FFmpeg filters
    // drawtext and colorchannelmixer excluded (not in all static builds)
    const filters = [
      `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
      `eq=brightness=${br}:contrast=${con}:saturation=${sat}`,
      `drawbox=x=0:y=${gradY}:w=iw:h=${h-gradY}:color=black@${oa.toFixed(2)}:t=fill`,
      `fade=t=in:st=0:d=${fadeIn}`,
      `fade=t=out:st=${fadeOutStart}:d=${fadeOut}`,
    ].join(",");

    // Kill FFmpeg if it runs too long (3 min timeout)
    let killed = false;
    const ffmpegCmd = ffmpeg(videoFile.path)
      .duration(duration)
      .videoFilters(filters)
      .fps(30)
      .videoCodec("libx264")
      .addOption("-preset", "ultrafast") // fastest preset — uses less memory
      .addOption("-crf", "23")           // slightly lower quality = less memory
      .addOption("-tune", "fastdecode")
      .addOption("-movflags", "+faststart")
      .addOption("-threads", "1")        // single thread — fits in Railway free RAM
      .audioCodec("aac")
      .audioBitrate("128k")
      .audioFilters(`afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutStart}:d=${fadeOut}`)
      .output(outputPath);

    const timeout = setTimeout(() => {
      killed = true;
      try { ffmpegCmd.kill("SIGKILL"); } catch {}
      try{fs.unlinkSync(videoFile.path);}catch{}
      if (!res.headersSent) res.status(500).json({ error: "Processing timed out — try a shorter or smaller video file" });
    }, 180000); // 3 minute hard limit

    ffmpegCmd
      .on("start", cmd => console.log("[FFmpeg] Command:", cmd.substring(0,200)))
      .on("progress", p => console.log(`[FFmpeg] ${Math.round(p.percent||0)}% — ${p.timemark}`))
      .on("end", () => {
        clearTimeout(timeout);
        if (killed) return;
        console.log("[FFmpeg] Done:", outputPath);
        res.download(outputPath, "martamescar_ad.mp4", () => {
          try{fs.unlinkSync(videoFile.path);}catch{}
          try{fs.unlinkSync(outputPath);}catch{}
        });      })
      .on("error", err => {
        clearTimeout(timeout);
        if (killed) return;
        console.error("[FFmpeg] Error:", err.message);
        try{fs.unlinkSync(videoFile.path);}catch{}
        if (!res.headersSent) res.status(500).json({ error: "FFmpeg error: " + err.message });
      })
      .run();
  });
});

// Image processing is client-side via Canvas
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`ArtAd Studio on port ${PORT}`));
