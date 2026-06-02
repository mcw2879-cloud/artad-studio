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
const upload = multer({ dest: "uploads/", limits: { fileSize: 200 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Ensure uploads dir exists
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("outputs")) fs.mkdirSync("outputs");

// ─── Health check ──────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", ffmpeg: !!ffmpegPath });
});

// ─── Claude analysis ────────────────────────────────────────────────────────
app.post("/api/analyse", upload.single("frame"), async (req, res) => {
  try {
    const { format, objective, productInfo } = req.body;
    const frameFile = req.file;
    if (!frameFile) return res.status(400).json({ error: "No frame provided" });

    const imageData = fs.readFileSync(frameFile.path).toString("base64");
    fs.unlinkSync(frameFile.path);

    const sys = `You are the world's leading Meta advertising creative director for fine art. Deep knowledge of Meta algorithm signals, neuromarketing, luxury buyer psychology, Saatchi Art / 1stDibs / Artsy competitor strategies, and what converts fine art buyers aged 30-65 in Europe.

Return ONLY valid JSON — no markdown, no backticks:

{
  "analysis": "3 sentences: content, emotional hooks, conversion opportunity vs competitors",
  "conversionInsights": "3 sentences: psychological triggers, Meta algorithm strategy, competitor patterns to beat",
  "crop": { "focusX": 0.5, "focusY": 0.38, "note": "string" },
  "colorGrade": { "brightness": 6, "contrast": 14, "saturation": 10, "warmth": 12, "note": "string" },
  "overlay": { "style": "gradient_bottom", "opacity": 0.52, "note": "string" },
  "hook": { "text": "8 words max scroll-stopper", "note": "string" },
  "headline": { "text": "35 chars max collector voice", "position": "bottom", "size": "large", "color": "#ffffff", "style": "serif", "note": "string" },
  "subtext": { "text": "40 chars max price + scarcity", "show": true, "color": "#f5e6c8" },
  "adCopy": {
    "primaryText": "125 chars max emotional + price + FOMO",
    "headline": "40 chars max",
    "description": "30 chars max",
    "cta": "SHOP_NOW",
    "variantB": "125 chars max social proof angle",
    "variantC": "125 chars max scarcity angle"
  },
  "audience": {
    "summary": "2 sentences + competitor overlap strategy",
    "ageRange": "32-65", "genders": "All",
    "locations": ["Spain","United Kingdom","Portugal","France","Germany"],
    "interests": ["Fine art","Art collecting","Interior design","Contemporary art","Saatchi Art","Home décor","Luxury goods","Art galleries"],
    "behaviors": ["Engaged shoppers","Luxury item buyers","Frequent international travellers"],
    "customAudiences": ["Website visitors last 30 days","Instagram engagers last 60 days","Video viewers 75%+"],
    "lookalike": "1-2% lookalike of website purchasers",
    "exclusions": ["Existing customers","Bounced visitors under 10 seconds"],
    "estimatedReach": "150,000-400,000",
    "whyThisAudience": "3 sentences"
  },
  "campaign": {
    "budgetDaily": "€20-35/day",
    "bidStrategy": "Lowest cost without cap",
    "placements": "Instagram Feed, Stories, Reels, Facebook Feed — exclude Audience Network",
    "schedule": "Tue-Sat 7pm-11pm local time",
    "abTest": "Test primary text A vs C same creative and audience",
    "kpis": { "ctr": ">2.5%", "cpc": "<€0.90", "roas": "4-8x after week 3" },
    "week1": ["Days 1-2: Launch €20/day monitor CPM above €18 narrow interests","Day 3: CTR below 1.5% test new primary text","Days 4-5: Best placement increase allocation 30%","Days 6-7: Add 1% lookalike if pixel has 50+ purchase events"]
  }
}`;

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1800,
      system: sys,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageData } },
          { type: "text", text: `Format: ${format}. Objective: ${objective}. Product: ${productInfo || "Original fine art by Marta Mescar, martamescar.com"}. Apply every conversion insight.` }
        ]
      }]
    });

    const txt = message.content[0].text;
    const data = JSON.parse(txt.replace(/```json|```/g, "").trim());
    res.json(data);
  } catch (e) {
    console.error("Analyse error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Video processing ────────────────────────────────────────────────────────
app.post("/api/process-video", upload.single("video"), async (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.status(400).json({ error: "No video provided" });

  let params;
  try { params = JSON.parse(req.body.params); }
  catch (e) { return res.status(400).json({ error: "Invalid params" }); }

  const fmt = JSON.parse(req.body.format);
  const outputPath = `outputs/edited_${Date.now()}.mp4`;

  const { w, h } = fmt;
  const cg = params.colorGrade || {};
  const br  = ((cg.brightness || 0) / 100).toFixed(3);
  const con = (1 + (cg.contrast || 0) / 100).toFixed(3);
  const sat = (1 + (cg.saturation || 0) / 100).toFixed(3);
  const wm  = cg.warmth || 0;

  // Safe text encoder for drawtext
  const safeText = t => (t || "").replace(/[':,\\]/g, " ").replace(/\s+/g, " ").trim().substring(0, 60);

  const hookText = safeText(params.hook?.text || "");
  const headText = safeText(params.headline?.text || "");
  const subText  = safeText(params.subtext?.text || "");
  const ff       = params.headline?.style === "sans" ? "Helvetica" : "Georgia";
  const pad      = Math.round(w * 0.07);
  const headFs   = Math.round(w * 0.062);
  const subFs    = Math.round(headFs * 0.52);
  const hookFs   = Math.round(w * 0.068);
  const urlFs    = Math.round(w * 0.028);
  const headY    = h - pad - urlFs - 16 - subFs - 14 - headFs;
  const subY     = h - pad - urlFs - 16 - subFs;
  const urlY     = h - pad;

  // Build filter chain
  const filters = [
    `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
    `eq=brightness=${br}:contrast=${con}:saturation=${sat}`,
    ...(wm > 0  ? [`curves=r='0/0 0.5/${(0.5+wm/500).toFixed(3)} 1/1':b='0/0 0.5/${(0.5-wm/600).toFixed(3)} 1/${(1-wm/300).toFixed(3)}'`] : []),
    `vignette=PI/5`,
  ];

  // Gradient overlay
  const ov = params.overlay?.style || "gradient_bottom";
  const oa = params.overlay?.opacity || 0.52;
  if (ov === "gradient_bottom") {
    filters.push(`geq=lum='lum(X\\,Y)':a='if(gt(Y\\,${Math.round(h*0.42)})\\,${Math.round(oa*255*(1-(h-1-0)/(h*0.58)))}\\,0)'`);
  }

  // Text overlays
  if (hookText) filters.push(`drawtext=text='${hookText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf:fontsize=${hookFs}:fontcolor=white:x=(w-text_w)/2:y=h*0.35:shadowcolor=black@0.85:shadowx=3:shadowy=3:enable='between(t\\,0\\,3.2)'`);
  if (headText) filters.push(`drawtext=text='${headText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf:fontsize=${headFs}:fontcolor=white:x=${pad}:y=${headY}:shadowcolor=black@0.75:shadowx=2:shadowy=2:enable='gt(t\\,0.4)'`);
  if (subText)  filters.push(`drawtext=text='${subText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf:fontsize=${subFs}:fontcolor=#f5e6c8:x=${pad}:y=${subY}:shadowcolor=black@0.65:shadowx=1:shadowy=1:enable='gt(t\\,0.4)'`);
  filters.push(`drawtext=text='martamescar.com':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=${urlFs}:fontcolor=white@0.65:x=${pad}:y=${urlY}:shadowcolor=black@0.5:shadowx=1:shadowy=1`);

  ffmpeg(videoFile.path)
    .videoFilters(filters.join(","))
    .duration(30)
    .fps(30)
    .videoCodec("libx264")
    .addOption("-preset", "fast")
    .addOption("-crf", "20")
    .addOption("-movflags", "+faststart")
    .audioCodec("aac")
    .audioBitrate("128k")
    .output(outputPath)
    .on("end", () => {
      res.download(outputPath, "martamescar_ad.mp4", err => {
        fs.unlinkSync(videoFile.path);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      });
    })
    .on("error", err => {
      console.error("FFmpeg error:", err);
      fs.unlinkSync(videoFile.path);
      res.status(500).json({ error: "Video processing failed: " + err.message });
    })
    .run();
});

// ─── Image processing ────────────────────────────────────────────────────────
app.post("/api/process-image", upload.single("image"), async (req, res) => {
  const imgFile = req.file;
  if (!imgFile) return res.status(400).json({ error: "No image provided" });

  let params, fmt;
  try {
    params = JSON.parse(req.body.params);
    fmt    = JSON.parse(req.body.format);
  } catch (e) { return res.status(400).json({ error: "Invalid params" }); }

  const { w, h } = fmt;
  const cg  = params.colorGrade || {};
  const br  = ((cg.brightness || 0) / 100).toFixed(3);
  const con = (1 + (cg.contrast || 0) / 100).toFixed(3);
  const sat = (1 + (cg.saturation || 0) / 100).toFixed(3);
  const wm  = cg.warmth || 0;
  const outputPath = `outputs/edited_${Date.now()}.jpg`;

  const safeText = t => (t || "").replace(/[':,\\]/g, " ").replace(/\s+/g, " ").trim().substring(0, 60);
  const headText = safeText(params.headline?.text || "");
  const subText  = safeText(params.subtext?.text || "");
  const pad      = Math.round(w * 0.07);
  const headFs   = Math.round(w * 0.062);
  const subFs    = Math.round(headFs * 0.52);
  const urlFs    = Math.round(w * 0.028);
  const headY    = h - pad - urlFs - 16 - subFs - 14 - headFs;
  const subY     = h - pad - urlFs - 16 - subFs;
  const urlY     = h - pad;
  const oa       = params.overlay?.opacity || 0.52;

  const filters = [
    `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
    `eq=brightness=${br}:contrast=${con}:saturation=${sat}`,
    ...(wm > 0 ? [`curves=r='0/0 0.5/${(0.5+wm/500).toFixed(3)} 1/1':b='0/0 0.5/${(0.5-wm/600).toFixed(3)} 1/${(1-wm/300).toFixed(3)}'`] : []),
    `vignette=PI/5`,
    `geq=lum='lum(X\\,Y)':a='if(gt(Y\\,${Math.round(h*0.42)})\\,${Math.round(oa*255)}\\,0)'`,
  ];

  if (headText) filters.push(`drawtext=text='${headText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf:fontsize=${headFs}:fontcolor=white:x=${pad}:y=${headY}:shadowcolor=black@0.75:shadowx=2:shadowy=2`);
  if (subText)  filters.push(`drawtext=text='${subText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf:fontsize=${subFs}:fontcolor=#f5e6c8:x=${pad}:y=${subY}:shadowcolor=black@0.65:shadowx=1:shadowy=1`);
  filters.push(`drawtext=text='martamescar.com':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=${urlFs}:fontcolor=white@0.65:x=${pad}:y=${urlY}:shadowcolor=black@0.5:shadowx=1:shadowy=1`);

  ffmpeg(imgFile.path)
    .videoFilters(filters.join(","))
    .frames(1)
    .output(outputPath)
    .on("end", () => {
      res.download(outputPath, "martamescar_ad.jpg", () => {
        fs.unlinkSync(imgFile.path);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      });
    })
    .on("error", err => {
      fs.unlinkSync(imgFile.path);
      res.status(500).json({ error: err.message });
    })
    .run();
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`✅ ArtAd Studio running on port ${PORT}`));
