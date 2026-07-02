(function (global) {
  "use strict";

  var watchdogIframe = null;
  var bootIframe = null;

  function getIframe(id) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement("iframe");
      el.id = id;
      el.title = "ocr watchdog";
      el.style.cssText =
        "position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none";
      el.setAttribute("sandbox", "allow-scripts allow-same-origin");
      document.body.appendChild(el);
    }
    return el;
  }

  function esc(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\r/g, "")
      .replace(/\n/g, "\\n");
  }

  function showErrorOnParent(title, message, logText) {
    try {
      var modal = document.getElementById("ocrErrorModal");
      var msgEl = document.getElementById("ocrErrorMessage");
      var logEl = document.getElementById("ocrErrorLog");
      var titleEl = document.getElementById("ocrErrorTitle");
      if (modal && msgEl && logEl) {
        if (titleEl) titleEl.textContent = title || "识别失败";
        msgEl.textContent = message || "识别失败";
        logEl.textContent = logText || "";
        modal.classList.remove("hidden");
        modal.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
        global.__ocrErrorShown = true;
        return true;
      }
    } catch (e) {}
    return false;
  }

  function stopWatchdog() {
    if (!watchdogIframe) return;
    try {
      var doc = watchdogIframe.contentDocument;
      if (doc) {
        doc.open();
        doc.write("");
        doc.close();
      }
    } catch (e) {}
  }

  function startWatchdog(ms, options) {
    stopWatchdog();
    options = options || {};
    var secs = Math.round(ms / 1000);
    var version = esc(options.version || "?");
    var lastStatus = esc(options.lastStatus || "");

    watchdogIframe = getIframe("ocrWatchdogIframe");
    var doc = watchdogIframe.contentDocument;
    doc.open();
    doc.write(
      "<!DOCTYPE html><html><body><script>\n" +
        "(function(){\n" +
        "  var deadline = Date.now() + " +
        ms +
        ";\n" +
        "  var timer = setInterval(function(){\n" +
        "    if (Date.now() < deadline) return;\n" +
        "    clearInterval(timer);\n" +
        "    try {\n" +
        "      parent.__ocrErrorShown = true;\n" +
        "      var d = parent.document;\n" +
        "      var modal = d.getElementById('ocrErrorModal');\n" +
        "      var msg = d.getElementById('ocrErrorMessage');\n" +
        "      var log = d.getElementById('ocrErrorLog');\n" +
        "      var snap = {\n" +
        "        version: '" +
        version +
        "',\n" +
        "        lastStatus: '" +
        lastStatus +
        "',\n" +
        "        cvReady: !!(parent.cv && parent.cv.Mat),\n" +
        "        opencvScript: !!d.querySelector('script[data-lottery-opencv=\"1\"]'),\n" +
        "        paddleEngine: !!parent.LotteryOcrEngine,\n" +
        "        ua: parent.navigator.userAgent\n" +
        "      };\n" +
        "      var lines = (parent.__lotteryOcrDiag || []).concat(['---', JSON.stringify(snap, null, 2)]);\n" +
        "      var errMsg = '识别引擎加载超时（已等待 " +
        secs +
        " 秒，请换 WiFi 后刷新重试）';\n" +
        "      if (modal && msg && log) {\n" +
        "        msg.textContent = errMsg;\n" +
        "        log.textContent = lines.join('\\n');\n" +
        "        modal.classList.remove('hidden');\n" +
        "        modal.setAttribute('aria-hidden','false');\n" +
        "        d.body.style.overflow = 'hidden';\n" +
        "      } else {\n" +
        "        parent.alert(errMsg);\n" +
        "      }\n" +
        "      var st = d.getElementById('ocrStatus');\n" +
        "      if (st) {\n" +
        "        st.textContent = errMsg;\n" +
        "        st.className = 'status ocr-status-line error';\n" +
        "      }\n" +
        "      var boot = d.getElementById('bootOverlay');\n" +
        "      if (boot) boot.classList.add('hidden');\n" +
        "    } catch(e) {}\n" +
        "  }, 400);\n" +
        "})();\n" +
        "<\/script></body></html>"
    );
    doc.close();
  }

  function startBootMonitor(timeoutMs) {
    var bootEl = document.getElementById("bootOverlay");
    if (!bootEl) return;

    global.__bootT0 = Date.now();
    bootIframe = getIframe("ocrBootMonitorIframe");
    var doc = bootIframe.contentDocument;
    var timeoutSec = Math.round(timeoutMs / 1000);
    doc.open();
    doc.write(
      "<!DOCTYPE html><html><body><script>\n" +
        "(function(){\n" +
        "  var deadline = Date.now() + " +
        timeoutMs +
        ";\n" +
        "  var timer = setInterval(function(){\n" +
        "    try {\n" +
        "      var d = parent.document;\n" +
        "      var boot = d.getElementById('bootOverlay');\n" +
        "      var status = d.getElementById('bootStatus');\n" +
        "      if (!boot || boot.classList.contains('hidden')) {\n" +
        "        clearInterval(timer);\n" +
        "        return;\n" +
        "      }\n" +
        "      if (parent.cv && parent.cv.Mat) {\n" +
        "        boot.classList.add('hidden');\n" +
        "        boot.setAttribute('aria-hidden','true');\n" +
        "        d.body.style.overflow = '';\n" +
        "        clearInterval(timer);\n" +
        "        return;\n" +
        "      }\n" +
        "      var sec = Math.round((Date.now() - (parent.__bootT0 || Date.now())) / 1000);\n" +
        "      if (status) status.textContent = 'OpenCV 编译中，已等待 ' + sec + ' 秒...';\n" +
        "      if (Date.now() >= deadline) {\n" +
        "        clearInterval(timer);\n" +
        "        parent.__ocrErrorShown = true;\n" +
        "        var modal = d.getElementById('ocrErrorModal');\n" +
        "        var msg = d.getElementById('ocrErrorMessage');\n" +
        "        var log = d.getElementById('ocrErrorLog');\n" +
        "        var errMsg = 'OpenCV 初始化超时（已等待 " +
        timeoutSec +
        " 秒，请换 WiFi 后刷新）';\n" +
        "        var diag = (parent.__lotteryOcrDiag || []).concat([\n" +
        "          'boot timeout',\n" +
        "          'cvReady=' + !!(parent.cv && parent.cv.Mat),\n" +
        "          'ua=' + parent.navigator.userAgent\n" +
        "        ]);\n" +
        "        if (modal && msg && log) {\n" +
        "          msg.textContent = errMsg;\n" +
        "          log.textContent = diag.join('\\n');\n" +
        "          modal.classList.remove('hidden');\n" +
        "          modal.setAttribute('aria-hidden','false');\n" +
        "          d.body.style.overflow = 'hidden';\n" +
        "        } else {\n" +
        "          parent.alert(errMsg);\n" +
        "        }\n" +
        "        boot.classList.add('hidden');\n" +
        "      }\n" +
        "    } catch(e) {}\n" +
        "  }, 500);\n" +
        "})();\n" +
        "<\/script></body></html>"
    );
    doc.close();
  }

  function hideBootOverlay() {
    var boot = document.getElementById("bootOverlay");
    if (!boot) return;
    if (global.cv && global.cv.Mat) {
      boot.classList.add("hidden");
      boot.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }
  }

  global.LotteryOcrWatchdog = {
    start: startWatchdog,
    stop: stopWatchdog,
    startBootMonitor: startBootMonitor,
    hideBootOverlay: hideBootOverlay,
    showError: showErrorOnParent,
  };
})(window);
