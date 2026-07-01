(function (global) {
  "use strict";

  function pageBasePath() {
    const path = global.location.pathname || "/";
    if (path.endsWith("/")) return path;
    return path.replace(/\/[^/]+$/, "/");
  }

  function opencvBasePath() {
    return pageBasePath() + "vendor/opencv/";
  }

  function opencvScriptUrl() {
    return opencvBasePath() + "opencv.js";
  }

  function cvReady() {
    return global.cv && global.cv.Mat;
  }

  function report(message, percent) {
    if (typeof global.__lotteryOpenCvOnProgress === "function") {
      global.__lotteryOpenCvOnProgress(message, percent);
    }
  }

  function fetchOpenCvSource() {
    const url = opencvScriptUrl();

    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "text";

      xhr.onprogress = function (event) {
        if (!event.lengthComputable) {
          report("正在下载 OpenCV...", 37);
          return;
        }
        const pct = 36 + Math.min(5, Math.round((event.loaded / event.total) * 5));
        const mb = (event.loaded / (1024 * 1024)).toFixed(1);
        const totalMb = (event.total / (1024 * 1024)).toFixed(1);
        report("正在下载 OpenCV " + mb + "/" + totalMb + "MB...", pct);
      };

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
          resolve(xhr.responseText);
          return;
        }
        reject(new Error("OpenCV 下载失败 HTTP " + String(xhr.status)));
      };

      xhr.onerror = function () {
        reject(new Error("OpenCV 下载失败，请检查网络"));
      };

      xhr.ontimeout = function () {
        reject(new Error("OpenCV 下载超时"));
      };

      xhr.timeout = 180000;
      report("正在连接 OpenCV...", 36);
      xhr.send();
    });
  }

  function runOpenCvSource(source) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      const base = opencvBasePath();
      const previousModule = global.Module || {};
      const previousCv = global.cv;

      function finishOk() {
        if (settled || !cvReady()) return;
        settled = true;
        clearInterval(initPoll);
        clearTimeout(timeout);
        report("OpenCV 就绪", 42);
        resolve(global.cv);
      }

      function finishErr(err) {
        if (settled) return;
        settled = true;
        clearInterval(initPoll);
        clearTimeout(timeout);
        global.Module = previousModule;
        if (previousCv === undefined) {
          delete global.cv;
        } else {
          global.cv = previousCv;
        }
        reject(err);
      }

      const timeout = setTimeout(function () {
        finishErr(
          new Error("OpenCV 初始化超时（WASM 编译较慢，请换 WiFi 或刷新重试）")
        );
      }, 180000);

      let initTicks = 0;
      const initPoll = setInterval(function () {
        initTicks += 1;
        finishOk();
        if (settled) return;
        if (initTicks % 4 === 0) {
          report(
            "OpenCV WASM 编译中，已等待 " + Math.round(initTicks * 0.5) + " 秒...",
            41
          );
        }
      }, 500);

      const moduleRef = previousCv && previousCv.Mat ? previousCv : {};
      global.cv = moduleRef;
      global.Module = Object.assign({}, previousModule, moduleRef, {
        locateFile: function (path) {
          return base + path;
        },
        onRuntimeInitialized: function () {
          finishOk();
        },
      });
      global.cv = global.Module;

      try {
        const script = document.createElement("script");
        script.type = "text/javascript";
        script.dataset.lotteryOpencv = "1";
        script.textContent = source;
        document.head.appendChild(script);
        finishOk();
      } catch (err) {
        finishErr(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async function downloadAndInit() {
    const source = await fetchOpenCvSource();
    report("OpenCV 下载完成，正在初始化 WASM...", 41);
    return runOpenCvSource(source);
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
