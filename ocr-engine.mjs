import { PaddleOCR } from "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm";

const PADDLE_PKG = "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2";
const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const WORKER_URL = PADDLE_PKG + "/dist/assets/worker-entry-C9UNuyOJ.js";

let enginePromise = null;

function sortOcrItems(items) {
  return items.slice().sort(function (a, b) {
    const ay = a.poly.reduce(function (s, p) {
      return s + p.y;
    }, 0) / a.poly.length;
    const ax = a.poly.reduce(function (s, p) {
      return s + p.x;
    }, 0) / a.poly.length;
    const by = b.poly.reduce(function (s, p) {
      return s + p.y;
    }, 0) / b.poly.length;
    const bx = b.poly.reduce(function (s, p) {
      return s + p.x;
    }, 0) / b.poly.length;
    if (Math.abs(ay - by) < 14) return ax - bx;
    return ay - by;
  });
}

function itemsToText(items) {
  return sortOcrItems(items)
    .map(function (item) {
      return item.text || "";
    })
    .filter(Boolean)
    .join("\n");
}

export async function initEngine(onProgress) {
  if (enginePromise) return enginePromise;

  enginePromise = PaddleOCR.create({
    lang: "ch",
    ocrVersion: "PP-OCRv5",
    textDetectionModelName: "PP-OCRv5_mobile_det",
    textRecognitionModelName: "PP-OCRv5_mobile_rec",
    textDetLimitSideLen: 960,
    textRecScoreThresh: 0.45,
    worker: {
      createWorker: function () {
        return new Worker(WORKER_URL, { type: "module" });
      },
    },
    ortOptions: {
      backend: "wasm",
      wasmPaths: ORT_WASM,
    },
  })
    .then(function (engine) {
      onProgress && onProgress("PaddleOCR 就绪", 38);
      return engine;
    })
    .catch(function (err) {
      enginePromise = null;
      throw err;
    });

  onProgress && onProgress("正在下载 PaddleOCR 模型（首次较慢）...", 36);
  return enginePromise;
}

export async function recognizeSource(source) {
  const engine = await initEngine();
  const results = await engine.predict(source);
  const items = (results[0] && results[0].items) || [];
  return {
    text: itemsToText(items),
    items: items,
  };
}

export async function recognizeDataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return recognizeSource(blob);
}

window.LotteryOcrEngine = {
  initEngine: initEngine,
  recognizeSource: recognizeSource,
  recognizeDataUrl: recognizeDataUrl,
};
