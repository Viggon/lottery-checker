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

  function report(message, percent) {
    if (typeof global.__lotteryOpenCvOnProgress === "function") {
      global.__lotteryOpenCvOnProgress(message, percent);
    }
  }

  function waitForCv(timeoutMs) {
    return new Promise(function (resolve, reject) {
      const started = Date.now();

      function step() {
        if (cvReady()) {
          report("OpenCV 就绪", 42);
          resolve(global.cv);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(
            new Error("OpenCV 初始化超时（WASM 编译较慢，请换 WiFi 或刷新重试）")
          );
          return;
        }
        setTimeout(step, 50);
      }

      step();
    });
  }

  function loadOpenCv() {
    if (cvReady()) {
      return Promise.resolve(global.cv);
    }
    if (global.__lotteryOpenCvPromise) {
      return global.__lotteryOpenCvPromise;
    }

    const url = opencvScriptUrl();
    global.__lotteryOpenCvPromise = new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-lottery-opencv="1"]')) {
        waitForCv(180000).then(resolve, reject);
        return;
      }

      report("正在加载 OpenCV（约 10MB）...", 37);
      report("OpenCV WASM 编译中，首次约需 30-60 秒，请勿关闭...", 41);

      const script = document.createElement("script");
      script.src = url;
      script.dataset.lotteryOpencv = "1";
      script.onerror = function () {
        reject(new Error("OpenCV 脚本加载失败"));
      };
      script.onload = function () {
        waitForCv(180000).then(resolve, reject);
      };
      document.head.appendChild(script);
    }).catch(function (err) {
      global.__lotteryOpenCvPromise = null;
      throw err;
    });

    return global.__lotteryOpenCvPromise;
  }

  global.__lotteryLoadOpenCv = loadOpenCv;
})(window);
