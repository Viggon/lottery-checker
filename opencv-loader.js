(function (global) {
  "use strict";

  function pageBasePath() {
    const path = global.location.pathname || "/";
    if (path.endsWith("/")) return path;
    return path.replace(/\/[^/]+$/, "/");
  }

  function opencvScriptUrl() {
    return pageBasePath() + "vendor/opencv/opencv.js";
  }

  function cvReady() {
    return global.cv && global.cv.Mat;
  }

  function ocrDiag(message) {
    const log = global.__lotteryOcrDiag || (global.__lotteryOcrDiag = []);
    const line = new Date().toISOString().slice(11, 19) + " opencv " + message;
    log.push(line);
    if (log.length > 100) log.shift();
  }

  function report(message, percent) {
    if (typeof global.__lotteryOpenCvOnProgress === "function") {
      global.__lotteryOpenCvOnProgress(message, percent);
    }
  }

  function waitForCv(timeoutMs) {
    return new Promise(function (resolve, reject) {
      const started = Date.now();
      let lastReport = 0;

      function step() {
        if (cvReady()) {
          ocrDiag("cv.Mat ready");
          report("OpenCV 就绪", 42);
          resolve(global.cv);
          return;
        }
        const elapsed = Date.now() - started;
        if (elapsed > timeoutMs) {
          ocrDiag("timeout " + String(elapsed) + "ms");
          reject(
            new Error("OpenCV 初始化超时（WASM 编译较慢，请换 WiFi 或刷新重试）")
          );
          return;
        }
        if (elapsed - lastReport >= 2000) {
          lastReport = elapsed;
          const sec = Math.round(elapsed / 1000);
          report("OpenCV WASM 编译中，已等待 " + sec + " 秒...", 41);
          ocrDiag("waiting " + sec + "s");
        }
        setTimeout(step, 200);
      }

      step();
    });
  }

  function injectOpenCvScript() {
    const url = opencvScriptUrl();

    if (cvReady()) {
      report("OpenCV 就绪", 42);
      return Promise.resolve(global.cv);
    }

    if (document.querySelector('script[data-lottery-opencv="1"]')) {
      ocrDiag("existing script");
      return waitForCv(180000);
    }

    return new Promise(function (resolve, reject) {
      ocrDiag("inject " + url);
      report("正在加载 OpenCV（约 10MB）...", 37);

      const script = document.createElement("script");
      script.src = url;
      script.dataset.lotteryOpencv = "1";
      script.onerror = function () {
        ocrDiag("script onerror");
        reject(new Error("OpenCV 脚本加载失败"));
      };
      script.onload = function () {
        ocrDiag("script onload");
        report("OpenCV WASM 编译中，首次约需 30-60 秒，请勿关闭...", 41);
        waitForCv(180000).then(resolve, reject);
      };
      document.head.appendChild(script);
    });
  }

  function loadOpenCv() {
    if (cvReady()) return Promise.resolve(global.cv);
    if (!global.__lotteryOpenCvPromise) {
      global.__lotteryOpenCvPromise = injectOpenCvScript().catch(function (err) {
        global.__lotteryOpenCvPromise = null;
        throw err;
      });
    }
    return global.__lotteryOpenCvPromise;
  }

  global.__lotteryLoadOpenCv = loadOpenCv;
})(window);
