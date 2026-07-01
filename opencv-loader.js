(function (global) {
  "use strict";

  function pageBasePath() {
    const path = global.location.pathname || "/";
    if (path.endsWith("/")) return path;
    return path.replace(/\/[^/]+$/, "/");
  }

  function cvReady() {
    return global.cv && global.cv.Mat;
  }

  function report(message, percent) {
    if (typeof global.__lotteryOpenCvOnProgress === "function") {
      global.__lotteryOpenCvOnProgress(message, percent);
    }
  }

  function injectScript(src) {
    return new Promise(function (resolve, reject) {
      const deadline = Date.now() + 120000;

      function finishOk() {
        if (!cvReady()) return;
        resolve(global.cv);
      }

      function finishErr(err) {
        reject(err);
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.lotteryOpencv = "1";
      script.onload = function () {
        finishOk();
        if (cvReady()) return;
        if (global.cv && !global.cv.Mat) {
          global.cv.onRuntimeInitialized = finishOk;
        }
        const poll = setInterval(function () {
          finishOk();
          if (cvReady()) {
            clearInterval(poll);
            return;
          }
          if (Date.now() > deadline) {
            clearInterval(poll);
            finishErr(new Error("OpenCV 初始化超时"));
          }
        }, 200);
      };
      script.onerror = function () {
        finishErr(new Error("OpenCV 脚本执行失败"));
      };
      document.head.appendChild(script);
    });
  }

  async function downloadAndInit() {
    if (global.__lotteryOpenCvPromise) {
      return global.__lotteryOpenCvPromise;
    }

    const url = pageBasePath() + "vendor/opencv/opencv.js";
    report("正在连接 OpenCV...", 36);

    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      throw new Error("OpenCV 下载失败 HTTP " + String(resp.status));
    }

    const total = Number(resp.headers.get("content-length")) || 0;
    if (!resp.body) {
      report("正在下载 OpenCV...", 37);
      const source = await resp.text();
      const blobUrl = URL.createObjectURL(
        new Blob([source], { type: "application/javascript" })
      );
      try {
        report("OpenCV 下载完成，正在初始化...", 41);
        return await injectScript(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }

    const reader = resp.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
      const step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      loaded += step.value.length;

      if (total > 0) {
        const pct = 36 + Math.min(5, Math.round((loaded / total) * 5));
        const mb = (loaded / (1024 * 1024)).toFixed(1);
        const totalMb = (total / (1024 * 1024)).toFixed(1);
        report("正在下载 OpenCV " + mb + "/" + totalMb + "MB...", pct);
      } else {
        const mb = (loaded / (1024 * 1024)).toFixed(1);
        report("正在下载 OpenCV " + mb + "MB...", 37);
      }
    }

    report("OpenCV 下载完成，正在初始化...", 41);
    const blobUrl = URL.createObjectURL(
      new Blob(chunks, { type: "application/javascript" })
    );
    try {
      const cv = await injectScript(blobUrl);
      report("OpenCV 就绪", 42);
      return cv;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  function loadOpenCv() {
    if (cvReady()) return Promise.resolve(global.cv);
    if (!global.__lotteryOpenCvPromise) {
      global.__lotteryOpenCvPromise = downloadAndInit().catch(function (err) {
        global.__lotteryOpenCvPromise = null;
        throw err;
      });
    }
    return global.__lotteryOpenCvPromise;
  }

  global.__lotteryOpenCvReady = loadOpenCv();
})(window);
