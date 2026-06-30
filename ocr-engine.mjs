import { PaddleOCR } from "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm";

const PADDLE_PKG = "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2";
const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const WORKER_URL = PADDLE_PKG + "/dist/assets/worker-entry-C9UNuyOJ.js";
const INIT_TIMEOUT_MS = 120000;

let enginePromise = null;

function isMobileDevice() {
  return (
    /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || "") ||
    (navigator.maxTouchPoints > 0 &&
      window.matchMedia &&
      window.matchMedia("(max-width: 768px)").matches)
  );
}

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
  if (/worker|Worker|importScripts|module/i.test(msg)) {
    return "OCR 引擎在手机上加载失败，请刷新后重试或使用相册选较小照片";
  }
  if (/fetch|network|Failed to fetch|Load model/i.test(msg)) {
    return "OCR 模型下载失败，请检查网络后重试";
  }
  if (/timeout|超时/i.test(msg)) {
    return "OCR 模型加载超时，请检查网络后重试";
  }
  return "OCR 引擎加载失败：" + msg;
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

function buildCreateOptions(useWorker) {
  const options = {
    lang: "ch",
    ocrVersion: "PP-OCRv5",
    textDetectionModelName: "PP-OCRv5_mobile_det",
    textRecognitionModelName: "PP-OCRv5_mobile_rec",
    textDetLimitSideLen: 960,
    textRecScoreThresh: 0.45,
    ortOptions: {
      backend: "wasm",
      wasmPaths: ORT_WASM,
    },
  };

  if (useWorker) {
    options.worker = {
      createWorker: function () {
        return new Worker(WORKER_URL, { type: "module" });
      },
    };
  } else {
    options.worker = false;
  }

  return options;
}

async function createEngine(useWorker) {
  return PaddleOCR.create(buildCreateOptions(useWorker));
}

export async function initEngine(onProgress) {
  if (enginePromise) return enginePromise;

  enginePromise = (async function () {
    onProgress && onProgress("正在加载 PaddleOCR...", 36);

    const mobile = isMobileDevice();
    const attempts = mobile ? [false] : [true, false];

    let lastError = null;
    for (let i = 0; i < attempts.length; i += 1) {
      const useWorker = attempts[i];
      try {
        if (i > 0) {
          onProgress &&
            onProgress("Worker 不可用，改为主线程加载...", 37);
        } else if (mobile) {
          onProgress &&
            onProgress("正在下载 OCR 模型（首次约需十几秒）...", 36);
        } else {
          onProgress &&
            onProgress("正在下载 OCR 模型（首次较慢）...", 36);
        }

        const engine = await withTimeout(
          createEngine(useWorker),
          INIT_TIMEOUT_MS,
          "PaddleOCR 加载超时"
        );
        onProgress && onProgress("PaddleOCR 就绪", 38);
        return engine;
      } catch (err) {
        lastError = err;
        console.warn("PaddleOCR init attempt failed", err);
      }
    }

    enginePromise = null;
    throw new Error(formatPaddleError(lastError));
  })();

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
