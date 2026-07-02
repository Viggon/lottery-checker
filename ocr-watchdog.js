(function (global) {
  "use strict";

  var watchdogIframe = null;
  var bootIframe = null;
  var permanentIframe = null;

  function getIframe(id) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement("iframe");
      el.id = id;
      el.title = "ocr watchdog";
      el.style.cssText =
        "position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none";
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

  function showStallBanner(message) {
    try {
      var boot = document.getElementById("bootOverlay");
      if (boot) boot.classList.add("hidden");
      var banner = document.getElementById("ocrStallBanner");
      var bannerText = document.getElementById("ocrStallBannerText");
      if (banner && bannerText) {
        bannerText.textContent = message;
        banner.classList.remove("hidden");
      }
    } catch (e) {}
  }

  function showErrorOnParent(title, message, logText) {
    try {
      showStallBanner(message);
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
    try {
      global.alert(message || "识别失败");
      global.__ocrErrorShown = true;
    } catch (e2) {}
    return false;
  }

  function fireScanError(errMsg, version) {
    try {
      global.__ocrErrorShown = true;
      global.__ocrScanActive = false;
      var snap = {
        version: version || "?",
        lastStatus: global.__ocrLastProgressMsg || "",
        cvReady: !!(global.cv && global.cv.Mat),
        paddleEngine: !!global.LotteryOcrEngine,
        ua: navigator.userAgent,
      };
      var lines = (global.__lotteryOcrDiag || []).concat([
        "---",
        JSON.stringify(snap, null, 2),
      ]);
      showStallBanner(errMsg);
      showErrorOnParent("识别失败", errMsg, lines.join("\n"));
      var st = document.getElementById("ocrStatus");
      if (st) {
        st.textContent = errMsg;
        st.className = "status ocr-status-line error";
      }
    } catch (e) {
      try {
        global.alert(errMsg);
      } catch (e2) {}
    }
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
    var stallMs = options.stallMs || 12000;
    var version = esc(options.version || "?");

    watchdogIframe = getIframe("ocrWatchdogIframe");
    var doc = watchdogIframe.contentDocument;
    doc.open();
    doc.write(
      "<!DOCTYPE html><html><body><script>\n" +
        "(function(){\n" +
        "  var deadline = Date.now() + " +
        ms +
        ";\n" +
        "  var stallMs = " +
        stallMs +
        ";\n" +
        "  var version = '" +
        version +
        "';\n" +
        "  function fireError(errMsg) {\n" +
        "    try {\n" +
        "      if (parent.LotteryOcrWatchdog && parent.LotteryOcrWatchdog.fireScanError) {\n" +
        "        parent.LotteryOcrWatchdog.fireScanError(errMsg, version);\n" +
        "        return;\n" +
        "      }\n" +
        "    } catch(e) {}\n" +
        "  }\n" +
        "  var timer = setInterval(function(){\n" +
        "    try {\n" +
        "      if (parent.__ocrScanActive && !parent.__ocrErrorShown) {\n" +
        "        var stalled = Date.now() - (parent.__ocrLastProgressAt || 0);\n" +
        "        var stuckMsg = parent.__ocrLastProgressMsg || '未知步骤';\n" +
        "        if (stalled > stallMs) {\n" +
        "          clearInterval(timer);\n" +
        "          fireError('识别卡住（停在：' + stuckMsg + '，已 ' + Math.round(stallMs / 1000) + ' 秒无进展）');\n" +
        "          return;\n" +
        "        }\n" +
        "      }\n" +
        "      if (Date.now() < deadline) return;\n" +
        "      clearInterval(timer);\n" +
        "      fireError('识别引擎加载超时（已等待 " +
        secs +
        " 秒，请换 WiFi 后刷新重试）');\n" +
        "    } catch(e) {}\n" +
        "  }, 400);\n" +
        "})();\n" +
        "<\/script></body></html>"
    );
    doc.close();
  }

  function startPermanentMonitor(stallMs) {
    if (permanentIframe) return;
    permanentIframe = getIframe("ocrPermanentMonitorIframe");
    var doc = permanentIframe.contentDocument;
    doc.open();
    doc.write(
      "<!DOCTYPE html><html><body><script>\n" +
        "(function(){\n" +
        "  var stallMs = " +
        stallMs +
        ";\n" +
        "  setInterval(function(){\n" +
        "    try {\n" +
        "      if (!parent.__ocrScanActive || parent.__ocrErrorShown) return;\n" +
        "      var stalled = Date.now() - (parent.__ocrLastProgressAt || 0);\n" +
        "      if (stalled < stallMs) return;\n" +
        "      var stuckMsg = parent.__ocrLastProgressMsg || '未知步骤';\n" +
        "      var errMsg = '识别卡住（停在：' + stuckMsg + '，已 ' + Math.round(stalled / 1000) + ' 秒无进展）';\n" +
        "      if (parent.LotteryOcrWatchdog && parent.LotteryOcrWatchdog.fireScanError) {\n" +
        "        parent.LotteryOcrWatchdog.fireScanError(errMsg, parent.__appVersion || '?');\n" +
        "      }\n" +
        "    } catch(e) {}\n" +
        "  }, 1000);\n" +
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
        "        parent.LotteryOcrWatchdog.fireScanError('OpenCV 初始化超时（已等待 " +
        timeoutSec +
        " 秒，请换 WiFi 后刷新）', parent.__appVersion || '?');\n" +
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
    startPermanentMonitor: startPermanentMonitor,
    hideBootOverlay: hideBootOverlay,
    showError: showErrorOnParent,
    fireScanError: fireScanError,
  };
})(window);
