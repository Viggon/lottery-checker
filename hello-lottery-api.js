(function (global) {
  "use strict";

  const SPACE_URL = "https://wushidiguo2-hellolottery.hf.space";
  const UPLOAD_TIMEOUT_MS = 60000;
  const RESULT_TIMEOUT_MS = 180000;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function touchProgress(message) {
    global.__ocrLastProgressAt = Date.now();
    global.__ocrLastProgressMsg = message;
  }

  function report(onProgress, percent, message) {
    touchProgress(message);
    if (typeof onProgress === "function") {
      onProgress(message, percent);
    }
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);
    try {
      return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  async function uploadImage(file, onProgress) {
    report(onProgress, 10, "正在上传照片到云端...");
    const form = new FormData();
    form.append("files", file, file.name || "lottery.jpg");
    const res = await fetchWithTimeout(
      SPACE_URL + "/upload",
      { method: "POST", body: form },
      UPLOAD_TIMEOUT_MS
    );
    if (!res.ok) {
      throw new Error("照片上传失败（HTTP " + res.status + "）");
    }
    const paths = await res.json();
    const path = Array.isArray(paths) ? paths[0] : paths;
    if (!path) throw new Error("照片上传未返回路径");
    return path;
  }

  function parseSseBody(body) {
    const blocks = String(body || "").split(/\r?\n\r?\n/);
    let lastError = "";

    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const block = blocks[i];
      if (!block.trim()) continue;

      let eventType = "";
      let dataLine = "";
      block.split(/\r?\n/).forEach(function (line) {
        if (line.indexOf("event:") === 0) eventType = line.slice(6).trim();
        if (line.indexOf("data:") === 0) dataLine = line.slice(5).trim();
      });

      if (eventType === "error" && dataLine) {
        lastError = dataLine.replace(/^"|"$/g, "");
        continue;
      }
      if (!dataLine || dataLine === "null" || dataLine === "[DONE]") continue;

      try {
        const parsed = JSON.parse(dataLine);
        if (Array.isArray(parsed)) {
          const first = parsed[0];
          if (typeof first === "string" && first.trim()) return first.trim();
          if (Array.isArray(first) && typeof first[0] === "string" && first[0].trim()) {
            return first[0].trim();
          }
        }
        if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
      } catch (_) {
        if (dataLine.length > 1) lastError = dataLine;
      }
    }

    if (lastError) throw new Error(lastError);
    throw new Error("未能解析云端识别结果");
  }

  async function startPredict(filePath, onProgress) {
    report(onProgress, 16, "连接 HelloLottery 云端 API...");
    const res = await fetchWithTimeout(
      SPACE_URL + "/call/predict",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [{ path: filePath, meta: { _type: "gradio.FileData" } }],
        }),
      },
      60000
    );
    if (!res.ok) {
      throw new Error("云端 API 调用失败（HTTP " + res.status + "）");
    }
    const json = await res.json();
    if (!json.event_id) throw new Error("云端 API 未返回任务 ID");
    return json.event_id;
  }

  async function waitForResult(eventId, onProgress) {
    const started = Date.now();
    let attempt = 0;

    while (Date.now() - started < RESULT_TIMEOUT_MS) {
      attempt += 1;
      const waitedSec = Math.round((Date.now() - started) / 1000);
      const percent = Math.min(92, 20 + Math.round(waitedSec * 1.2));
      report(
        onProgress,
        percent,
        attempt === 1
          ? "云端识别中（Space 休眠时首次可能需 1～2 分钟）..."
          : "云端识别中（已等待 " + waitedSec + " 秒）..."
      );

      const res = await fetchWithTimeout(
        SPACE_URL + "/call/predict/" + encodeURIComponent(eventId),
        { method: "GET", headers: { Accept: "text/event-stream" } },
        Math.min(90000, RESULT_TIMEOUT_MS - (Date.now() - started))
      );
      const text = await res.text();

      if (/event:\s*error/i.test(text)) {
        throw new Error(parseSseBody(text));
      }
      if (/event:\s*complete/i.test(text) || /data:\s*\["/.test(text)) {
        return parseSseBody(text);
      }
      if (!res.ok) {
        throw new Error("获取云端结果失败（HTTP " + res.status + "）");
      }

      await sleep(600);
    }

    throw new Error("云端识别超时（已等待 " + Math.round(RESULT_TIMEOUT_MS / 1000) + " 秒）");
  }

  async function recognizeImage(file, onProgress) {
    if (!file) throw new Error("请先选择或拍摄照片");
    report(onProgress, 4, "准备云端识别...");
    const filePath = await uploadImage(file, onProgress);
    const eventId = await startPredict(filePath, onProgress);
    const output = await waitForResult(eventId, onProgress);
    if (!output) throw new Error("云端返回空结果");
    report(onProgress, 100, "云端识别完成");
    return output;
  }

  global.HelloLotteryApi = {
    SPACE_URL: SPACE_URL,
    enabled: true,
    recognizeImage: recognizeImage,
  };
})(window);
