(function (global) {
  "use strict";

  var OPENCV_URLS = [
    "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.1/dist/opencv.js",
    "https://unpkg.com/@techstark/opencv-js@4.9.0-release.1/dist/opencv.js",
    "https://registry.npmmirror.com/@techstark/opencv-js/4.9.0-release.1/files/dist/opencv.js",
  ];

  function cvReady() {
    return global.cv && global.cv.Mat;
  }

  if (cvReady()) {
    global.__lotteryOpenCvReady = Promise.resolve(global.cv);
    return;
  }

  if (global.__lotteryOpenCvReady) {
    return;
  }

  global.__lotteryOpenCvReady = new Promise(function (resolve, reject) {
    var settled = false;
    var urlIndex = 0;

    function finishOk() {
      if (settled) return;
      if (!cvReady()) return;
      settled = true;
      clearTimeout(timeout);
      resolve(global.cv);
    }

    function finishErr(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      global.__lotteryOpenCvReady = null;
      reject(err);
    }

    var timeout = setTimeout(function () {
      finishErr(new Error("OpenCV 加载超时"));
    }, 120000);

    function waitForExistingScript() {
      var tries = 0;
      var poll = setInterval(function () {
        tries += 1;
        finishOk();
        if (settled) {
          clearInterval(poll);
          return;
        }
        if (tries >= 600) {
          clearInterval(poll);
          tryNextUrl(new Error("OpenCV 初始化超时"));
        }
      }, 200);
    }

    function tryNextUrl(lastError) {
      if (urlIndex >= OPENCV_URLS.length) {
        finishErr(lastError || new Error("OpenCV 加载失败"));
        return;
      }

      var url = OPENCV_URLS[urlIndex];
      urlIndex += 1;

      var previousModule = global.Module || {};
      global.Module = Object.assign({}, previousModule, {
        onRuntimeInitialized: function () {
          finishOk();
        },
      });

      var script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.lotteryOpencv = "1";
      script.onload = function () {
        finishOk();
        if (settled) return;
        waitForExistingScript();
      };
      script.onerror = function () {
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        tryNextUrl(new Error("OpenCV 加载失败"));
      };
      document.head.appendChild(script);
    }

    var existing = document.querySelector('script[data-lottery-opencv="1"]');
    if (existing) {
      waitForExistingScript();
      return;
    }

    tryNextUrl(null);
  });
})(window);
