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

  function loadOpenCv() {
    if (cvReady()) {
      return Promise.resolve(global.cv);
    }
    if (global.__lotteryOpenCvPromise) {
      return global.__lotteryOpenCvPromise;
    }

    global.__lotteryOpenCvPromise = new Promise(function (resolve, reject) {
      const deadline = Date.now() + 120000;

      function finishOk() {
        if (!cvReady()) return;
        clearTimeout(timeout);
        resolve(global.cv);
      }

      function finishErr(err) {
        clearTimeout(timeout);
        global.__lotteryOpenCvPromise = null;
        reject(err);
      }

      const timeout = setTimeout(function () {
        finishErr(new Error("OpenCV 加载超时"));
      }, 120000);

      const script = document.createElement("script");
      script.src = pageBasePath() + "vendor/opencv/opencv.js";
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
        finishErr(new Error("OpenCV 加载失败"));
      };
      document.head.appendChild(script);
    });

    return global.__lotteryOpenCvPromise;
  }

  global.__lotteryOpenCvReady = loadOpenCv();
})(window);
