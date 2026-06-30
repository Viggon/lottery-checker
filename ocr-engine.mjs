import { PaddleOCR } from "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm";

const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
const MODEL_DET = new URL("./paddle-models/PP-OCRv5_mobile_det_onnx_infer.tar", import.meta.url);
const MODEL_REC = new URL("./paddle-models/PP-OCRv5_mobile_rec_onnx_infer.tar", import.meta.url);
const INIT_TIMEOUT_MS = 180000;

let enginePromise = null;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error(message));
      }, ms);
    }),
  ]);
}

function formatPaddleError(err) {
  const msg = String((err && err.message) || err || "未知错误");
  if (/fetch|network|Failed to fetch|download/i.test(msg)) {
    return "PaddleOCR 模型加载失败，请刷新页面后重试";
  }
  if (/timeout|超时/i.test(msg)) {
    return "PaddleOCR 加载超时，请刷新后重试";
  }
  if (/memory|allocation|OOM/i.test(msg)) {
    return "内存不足，请关闭其他标签页或使用更小的照片";
  }
  return "PaddleOCR 加载失败：" + msg;
}

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

function createProgressFetch(onProgress) {
  const totals = {};
  const loaded = {};

  return async function progressFetch(input, init) {
    const url = String(input);
    const response = await fetch(input, init);
    if (!response.ok) {
      throw new Error("Failed to download " + url + ": HTTP " + String(response.status));
    }

    const total = Number(response.headers.get("content-length")) || 0;
    totals[url] = total;
    loaded[url] = 0;

    if (!response.body || !total) {
      return response;
    }

    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
      const step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      loaded[url] += step.value.length;

      let sumTotal = 0;
      let sumLoaded = 0;
      Object.keys(totals).forEach(function (key) {
        sumTotal += totals[key] || 0;
        sumLoaded += loaded[key] || 0;
      });

      if (onProgress && sumTotal > 0) {
        const pct = 36 + Math.min(8, Math.round((sumLoaded / sumTotal) * 8));
        const mb = (sumLoaded / (1024 * 1024)).toFixed(1);
        const totalMb = (sumTotal / (1024 * 1024)).toFixed(0);
        onProgress("正在加载模型 " + mb + "/" + totalMb + "MB...", pct);
      }
    }

    return new Response(new Blob(chunks), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export async function initEngine(onProgress) {
  if (enginePromise) return enginePromise;

  enginePromise = (async function () {
    onProgress && onProgress("正在初始化 PaddleOCR...", 36);

    const progressFetch = createProgressFetch(onProgress);

    const engine = await withTimeout(
      PaddleOCR.create({
        lang: "ch",
        ocrVersion: "PP-OCRv5",
        textDetectionModelName: "PP-OCRv5_mobile_det",
        textDetectionModelDir: { url: MODEL_DET.href },
        textRecognitionModelName: "PP-OCRv5_mobile_rec",
        textRecognitionModelDir: { url: MODEL_REC.href },
        textDetLimitSideLen: 960,
        textRecScoreThresh: 0.45,
        worker: false,
        fetch: progressFetch,
        ortOptions: {
          backend: "wasm",
          wasmPaths: ORT_WASM,
          numThreads: 1,
        },
      }),
      INIT_TIMEOUT_MS,
      "PaddleOCR 加载超时"
    );

    onProgress && onProgress("PaddleOCR 就绪", 44);
    return engine;
  })().catch(function (err) {
    enginePromise = null;
    throw new Error(formatPaddleError(err));
  });

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
