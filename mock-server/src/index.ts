#!/usr/bin/env node

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import {
  chatResponses,
  sampleERC20Contract,
  sampleAuditReport,
  sampleNewsArticles,
  sampleChatHistory,
  supportedChains,
  simplifiedABI,
  promptEnhancements,
  promptSuffixes,
  placeholderPngBytes,
  creditCosts,
} from "./fixtures";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// ─── State ─────────────────────────────────────────────────────────
const progressState: Record<string, number> = {};
let totalCreditsUsed = 0;

// ─── Middleware ─────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Artificial latency (100-500ms)
app.use((_req: Request, _res: Response, next: NextFunction) => {
  const delay = Math.floor(Math.random() * 400) + 100;
  setTimeout(next, delay);
});

// Auth check (accepts any Bearer token, just verifies presence)
app.use((req: Request, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({
      status: "error",
      error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" },
    });
    return;
  }
  next();
});

// Request logging
function logRequest(method: string, path: string, model?: string, credits?: number) {
  const creditStr = credits !== undefined ? ` | cost: ${credits} credits` : "";
  const modelStr = model ? ` | model: ${model}` : "";
  totalCreditsUsed += credits || 0;
  console.log(
    `[MOCK] ${new Date().toISOString()} ${method} ${path}${modelStr}${creditStr} | session total: ${totalCreditsUsed.toFixed(1)} credits`
  );
}

// ─── Helper ────────────────────────────────────────────────────────
function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── 1. POST /chat/stream ──────────────────────────────────────────
app.post("/chat/stream", (req: Request, res: Response) => {
  const { model, question, chatHistory: historyFlag } = req.body;
  const wantsHistory = historyFlag === "on";
  const wantsStream =
    req.headers.accept?.includes("text/event-stream") ||
    req.body.responseType === "stream";

  let botResponse: string;
  let creditKey: string;

  switch (model) {
    case "smart_contract_generator":
      botResponse = sampleERC20Contract;
      creditKey = wantsHistory
        ? "chat:smart_contract_generator:history"
        : "chat:smart_contract_generator";
      break;
    case "smart_contract_auditor":
      botResponse = sampleAuditReport;
      creditKey = wantsHistory
        ? "chat:smart_contract_auditor:history"
        : "chat:smart_contract_auditor";
      break;
    case "general_assistant":
    default:
      botResponse = randomItem(chatResponses);
      creditKey = wantsHistory
        ? "chat:general_assistant:history"
        : "chat:general_assistant";
      break;
  }

  const credits = creditCosts[creditKey] || 0.5;
  logRequest("POST", "/chat/stream", model, credits);

  if (wantsStream) {
    // Streaming response (Server-Sent Events)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Credit-Cost", String(credits));

    const words = botResponse.split(" ");
    let index = 0;

    const interval = setInterval(() => {
      if (index < words.length) {
        const chunk = words.slice(index, index + 3).join(" ");
        res.write(`data: ${JSON.stringify({ bot: chunk })}\n\n`);
        index += 3;
      } else {
        res.write("data: [DONE]\n\n");
        clearInterval(interval);
        res.end();
      }
    }, 50);
  } else {
    // Blob response
    res.setHeader("X-Credit-Cost", String(credits));
    res.json({
      status: "success",
      data: {
        user: question || "",
        bot: botResponse,
      },
    });
  }
});

// ─── 2. GET /chat/chatHistory ──────────────────────────────────────
app.get("/chat/chatHistory", (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const offset = parseInt(req.query.offset as string) || 0;

  logRequest("GET", "/chat/chatHistory", undefined, 0);

  const sliced = sampleChatHistory.slice(offset, offset + limit);
  res.json({
    status: "success",
    data: sliced,
    total: sampleChatHistory.length,
    limit,
    offset,
  });
});

// ─── 3. POST /nft/generate-image ──────────────────────────────────
app.post("/nft/generate-image", (req: Request, res: Response) => {
  const { model, enhance } = req.body;
  let credits = 1;
  if (enhance === "1x") credits = 2;
  if (enhance === "2x") credits = 3;
  if (model === "Dale3") credits = 4.75;

  logRequest("POST", "/nft/generate-image", model, credits);

  res.json({
    data: placeholderPngBytes,
  });
});

// ─── 4. POST /nft/generate-multiple-images ─────────────────────────
app.post("/nft/generate-multiple-images", (req: Request, res: Response) => {
  const prompts = req.body.prompts || [];
  const count = prompts.length || 2;

  logRequest("POST", "/nft/generate-multiple-images", undefined, count);

  const images = Array.from({ length: count }, () => ({
    data: placeholderPngBytes,
  }));

  res.json({ data: images });
});

// ─── 5. POST /nft/generate-nft-queue ───────────────────────────────
app.post("/nft/generate-nft-queue", (req: Request, res: Response) => {
  const amount = req.body.amount || 1;
  const collectionId = `mock-collection-${generateUUID()}`;

  logRequest("POST", "/nft/generate-nft-queue", undefined, amount);

  progressState[collectionId] = 0;

  res.json({
    data: {
      collectionId,
      status: "queued",
    },
  });
});

// ─── 6. GET /nft/progress/:collectionId ────────────────────────────
app.get("/nft/progress/:collectionId", (req: Request, res: Response) => {
  const { collectionId } = req.params;

  logRequest("GET", `/nft/progress/${collectionId}`, undefined, 0);

  const currentProgress = progressState[collectionId] ?? 0;

  if (currentProgress < 50) {
    // First call: processing
    progressState[collectionId] = 50;
    res.json({
      data: {
        collectionId,
        status: "processing",
        progress: 50,
      },
    });
  } else {
    // Subsequent calls: completed
    progressState[collectionId] = 100;
    res.json({
      data: {
        collectionId,
        status: "completed",
        progress: 100,
        images: [
          "https://mock.ipfs/image1.png",
          "https://mock.ipfs/image2.png",
          "https://mock.ipfs/image3.png",
        ],
        generated: true,
      },
    });
  }
});

// ─── 7. POST /nft/mint-nft ─────────────────────────────────────────
app.post("/nft/mint-nft", (req: Request, res: Response) => {
  const { collectionId, name, description, symbol, ids } = req.body;

  logRequest("POST", "/nft/mint-nft", undefined, 0);

  const mintedIds = ids || [1];
  res.json({
    status: "success",
    data: {
      collectionId: collectionId || `mock-collection-${generateUUID()}`,
      name: name || "Mock NFT Collection",
      symbol: symbol || "MNFT",
      description: description || "A mock NFT collection",
      tokens: mintedIds.map((id: number) => ({
        tokenId: id,
        tokenURI: `ipfs://QmMock${generateUUID().slice(0, 16)}/${id}.json`,
        imageURI: `ipfs://QmMock${generateUUID().slice(0, 16)}/${id}.png`,
        metadata: {
          name: `${name || "Mock NFT"} #${id}`,
          description: description || "AI-generated NFT",
          image: `ipfs://QmMock${generateUUID().slice(0, 16)}/${id}.png`,
          attributes: [
            { trait_type: "Generator", value: "ChainGPT AI" },
            { trait_type: "Rarity", value: "Legendary" },
          ],
        },
      })),
    },
  });
});

// ─── 8. POST /nft/enhancePrompt ────────────────────────────────────
app.post("/nft/enhancePrompt", (req: Request, res: Response) => {
  const { prompt } = req.body;

  logRequest("POST", "/nft/enhancePrompt", undefined, 0.5);

  const prefix = randomItem(promptEnhancements);
  const suffix = randomItem(promptSuffixes);
  const enhanced = `${prefix} ${prompt || "a mysterious digital landscape"}${suffix}`;

  res.json({
    enhancedPrompt: enhanced,
  });
});

// ─── 9. GET /nft/get-chains ────────────────────────────────────────
app.get("/nft/get-chains", (req: Request, res: Response) => {
  const testNet = req.query.testNet === "true";

  logRequest("GET", "/nft/get-chains", undefined, 0);

  if (testNet) {
    res.json({
      data: [
        { name: "Goerli", chainId: 5 },
        { name: "Sepolia", chainId: 11155111 },
        { name: "BSC Testnet", chainId: 97 },
        { name: "Mumbai", chainId: 80001 },
        { name: "Arbitrum Goerli", chainId: 421613 },
      ],
    });
  } else {
    res.json({ data: supportedChains });
  }
});

// ─── 10. GET /nft/abi ──────────────────────────────────────────────
app.get("/nft/abi", (_req: Request, res: Response) => {
  logRequest("GET", "/nft/abi", undefined, 0);
  res.json({ data: simplifiedABI });
});

// ─── 11. GET /news ─────────────────────────────────────────────────
app.get("/news", (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
  const offset = parseInt(req.query.offset as string) || 0;
  const categoryId = req.query.categoryId
    ? parseInt(req.query.categoryId as string)
    : null;
  const subCategoryId = req.query.subCategoryId
    ? parseInt(req.query.subCategoryId as string)
    : null;
  const tokenId = req.query.tokenId
    ? parseInt(req.query.tokenId as string)
    : null;

  logRequest("GET", "/news", undefined, 0.1);

  let filtered = [...sampleNewsArticles];

  if (categoryId !== null) {
    filtered = filtered.filter((a) => a.categoryId === categoryId);
  }
  if (subCategoryId !== null) {
    filtered = filtered.filter((a) => a.subCategoryId === subCategoryId);
  }
  if (tokenId !== null) {
    filtered = filtered.filter((a) => a.tokenId === tokenId);
  }

  const total = filtered.length;
  const sliced = filtered.slice(offset, offset + limit);

  res.json({
    status: "success",
    data: sliced,
    total,
    limit,
    offset,
  });
});

// ─── Health Check ──────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    server: "@chaingpt/mock-server",
    version: "1.0.0",
    uptime: process.uptime(),
    totalCreditsSimulated: totalCreditsUsed,
  });
});

// ─── 404 Handler ───────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    status: "error",
    error: { code: "NOT_FOUND", message: "Endpoint not found" },
  });
});

// ─── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║          ChainGPT Mock API Server v1.0.0                ║
║          Running on http://localhost:${PORT}              ║
╠══════════════════════════════════════════════════════════╣
║  Endpoints:                                              ║
║    POST /chat/stream        (LLM, Generator, Auditor)   ║
║    GET  /chat/chatHistory   (Chat history)               ║
║    POST /nft/generate-image (Single image)               ║
║    POST /nft/generate-multiple-images                    ║
║    POST /nft/generate-nft-queue (Async generation)       ║
║    GET  /nft/progress/:id   (Job progress)               ║
║    POST /nft/mint-nft       (Mint NFTs)                  ║
║    POST /nft/enhancePrompt  (Prompt enhancement)         ║
║    GET  /nft/get-chains     (Supported chains)           ║
║    GET  /nft/abi            (Mint factory ABI)           ║
║    GET  /news               (Crypto news)                ║
║    GET  /health             (Server health)               ║
╠══════════════════════════════════════════════════════════╣
║  Any Bearer token accepted. Credits logged per request.  ║
║  100-500ms artificial latency per request.                ║
╚══════════════════════════════════════════════════════════╝
  `);
});

export default app;
