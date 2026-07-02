(function (global) {
  "use strict";

  let ocrEngineReady = null;
  let paddleBundlePromise = null;

  function loadPaddleBundle() {
    if (paddleBundlePromise) return paddleBundlePromise;
    if (
      global.LotteryOcrEngine &&
      typeof global.LotteryOcrEngine.initEngine === "function"
    ) {
      paddleBundlePromise = Promise.resolve();
      return paddleBundlePromise;
    }

    paddleBundlePromise = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.type = "module";
      script.src = "./vendor/paddle-ocr.js";
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        paddleBundlePromise = null;
        reject(new Error("OCR 引擎脚本加载失败，请刷新后重试"));
      };
      document.head.appendChild(script);
    });

    return paddleBundlePromise;
  }

  async function ensureOcrEngineModule() {
    await loadPaddleBundle();
    for (let i = 0; i < 300; i += 1) {
      if (
        global.LotteryOcrEngine &&
        typeof global.LotteryOcrEngine.initEngine === "function"
      ) {
        return global.LotteryOcrEngine;
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, 100);
      });
    }
    throw new Error("OCR 引擎脚本未加载，请刷新页面后重试");
  }

  function loadOcrEngine(report) {
    if (ocrEngineReady) return ocrEngineReady;
    global.__lotteryOpenCvOnProgress = report
      ? function (message, percent) {
          report(percent || 36, message);
        }
      : null;
    ocrEngineReady = ensureOcrEngineModule()
      .then(function (engineMod) {
        return engineMod.initEngine(function (message, percent) {
          if (report) report(percent || 36, message);
        });
      })
      .catch(function (err) {
        ocrEngineReady = null;
        throw err;
      })
      .finally(function () {
        global.__lotteryOpenCvOnProgress = null;
      });
    return ocrEngineReady;
  }

  function resetOcrEngine() {
    ocrEngineReady = null;
    paddleBundlePromise = null;
    global.__lotteryOpenCvPromise = null;
    if (
      global.LotteryOcrEngine &&
      typeof global.LotteryOcrEngine.resetEngine === "function"
    ) {
      return global.LotteryOcrEngine.resetEngine();
    }
    return Promise.resolve();
  }

  async function recognizeDataUrl(dataUrl) {
    const engineMod = await ensureOcrEngineModule();
    return engineMod.recognizeDataUrl(dataUrl);
  }

  function normalize2(value) {
    const n = String(value).trim();
    return n.length === 1 ? "0" + n : n;
  }

  function letterToDigit(ch) {
    const map = {
      O: "0",
      o: "0",
      Q: "0",
      I: "1",
      l: "1",
      L: "1",
      Z: "2",
      z: "2",
      S: "5",
      s: "5",
      G: "9",
      g: "9",
      B: "8",
      b: "8",
      T: "7",
      t: "7",
    };
    return map[ch] != null ? map[ch] : null;
  }

  function fixOcrText(text, preserveLines) {
    let result = text
      .replace(/[OoQ]/g, "0")
      .replace(/[Il|]/g, "1")
      .replace(/[，,；;／/\\|｜＝=：:]/g, " ")
      .replace(/[【】\[\]()（）{}]/g, " ")
      .replace(/[＋]/g, "+");

    if (preserveLines) {
      return result
        .split(/\n/)
        .map(function (line) {
          return line.replace(/[^\S\n]+/g, " ").trim();
        })
        .filter(Boolean)
        .join("\n");
    }

    return result.replace(/\s+/g, " ").trim();
  }

  function ballsFromToken(raw) {
    const token = String(raw || "").trim();
    if (!token) return [];

    const out = [];
    const seen = new Set();

    function add(num) {
      if (num == null || num === "") return;
      const raw = String(num).replace(/null/gi, "");
      if (!/^\d{1,2}$/.test(raw)) return;
      const n = normalize2(raw);
      if (!inRange(n, 1, 33)) return;
      if (seen.has(n)) return;
      seen.add(n);
      out.push(n);
    }

    function addCandidates(list) {
      list.forEach(add);
    }

    const cleaned = token
      .replace(/[$#@]/g, "")
      .replace(/[xX×]/g, "")
      .replace(/[.,]/g, " ")
      .replace(/[OoQ]/g, "0")
      .replace(/[Il|]/g, "1");

    const compact = cleaned.replace(/\s+/g, "");
    const digitsOnly = compact.replace(/\D/g, "");

    if (/^[0-9]{1,2}$/.test(compact)) {
      add(compact);
      return out;
    }

    if (/^[0-9OIl][A-Za-z]$/.test(compact)) {
      const d1 = letterToDigit(compact[0]) || compact[0];
      const d2 = letterToDigit(compact[1]);
      if (d2 != null) add(String(d1) + String(d2));
      if (compact[1].toLowerCase() === "g") add(String(d1) + "4");
      if (compact[1].toUpperCase() === "S") add(String(d1) + "9");
      return out;
    }

    if (digitsOnly.length === 3) {
      if (/^[1-5]/.test(digitsOnly)) {
        const tail = digitsOnly.slice(1);
        if (inRange(tail, 1, 33)) add(tail);
      }
      if (inRange(digitsOnly.slice(0, 2), 1, 33)) add(digitsOnly.slice(0, 2));
      if (inRange(digitsOnly.slice(1), 1, 33)) add(digitsOnly.slice(1));
      return out;
    }

    if (digitsOnly.length === 4) {
      add(digitsOnly.slice(0, 2));
      add(digitsOnly.slice(2));
      return out;
    }

    if (digitsOnly.length >= 5) {
      for (let i = 0; i + 1 < digitsOnly.length; i += 2) {
        add(digitsOnly.slice(i, i + 2));
      }
      return out;
    }

    if (cleaned.indexOf(" ") !== -1) {
      cleaned.split(/\s+/).filter(Boolean).forEach(function (part) {
        const partDigits = part.replace(/\D/g, "");
        if (partDigits.length <= 2 && inRange(partDigits, 1, 33)) {
          add(partDigits);
        }
      });
    }

    return out;
  }

  function expandTokensToOptionGroups(tokens) {
    const groups = [];
    tokens.forEach(function (token) {
      const balls = ballsFromToken(token);
      const merged =
        balls.length > 1 &&
        (/[.,]/.test(token) || String(token).replace(/\D/g, "").length >= 4);
      if (merged) {
        balls.forEach(function (n) {
          groups.push([n]);
        });
        return;
      }
      groups.push(balls.length ? balls : []);
    });
    return groups;
  }

  function dfsPickSix(options, idx, path) {
    if (path.length === 6) {
      return isValidSsqReds(path) ? path.slice() : null;
    }
    if (idx >= options.length) return null;

    const skipped = dfsPickSix(options, idx + 1, path);
    if (skipped) return skipped;

    const choices = options[idx];
    for (let i = 0; i < choices.length; i += 1) {
      const n = choices[i];
      if (path.length && parseInt(n, 10) <= parseInt(path[path.length - 1], 10)) continue;
      if (path.indexOf(n) !== -1) continue;
      path.push(n);
      const found = dfsPickSix(options, idx + 1, path);
      if (found) return found;
      path.pop();
    }
    return null;
  }

  function solveRedsFromTokens(tokens) {
    const attempts = [tokens];
    const firstDigits = String(tokens[0] || "").replace(/\D/g, "");
    if (/^[1-5]\d{2}$/.test(firstDigits)) {
      attempts.push(tokens.slice(1));
    }

    for (let i = 0; i < attempts.length; i += 1) {
      const groups = expandTokensToOptionGroups(attempts[i]);
      const reds = dfsPickSix(groups, 0, []);
      if (reds) return reds;
    }
    return null;
  }

  function extractBallTokens(text) {
    const fixed = fixOcrText(text, false);
    const out = [];
    fixed.split(/[\s+]+/).filter(Boolean).forEach(function (token) {
      ballsFromToken(token).forEach(function (n) {
        out.push(n);
      });
    });
    return out;
  }

  function extractNumbers(text) {
    return extractBallTokens(text);
  }

  function blueFromToken(token) {
    const direct = String(token || "").match(/(\d{1,2})/);
    if (direct) {
      const n = normalize2(direct[1]);
      if (inRange(n, 1, 16)) return n;
    }

    const cleaned = String(token || "")
      .replace(/[.,]/g, " ")
      .replace(/[^\d\s]/g, " ")
      .trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);

    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i];
      if (/^0+$/.test(part)) return "02";
      const nums = ballsFromToken(part).filter(function (n) {
        return inRange(n, 1, 16);
      });
      if (nums.length) return nums[0];
    }

    const digits = cleaned.replace(/\D/g, "");
    if (digits.length >= 2) {
      const tail = normalize2(digits.slice(-2));
      if (inRange(tail, 1, 16)) return tail;
    }
    if (/^0+$/.test(digits)) return "02";
    return null;
  }

  function tryBuildSsqLine(redPart, bluePart) {
    const blue = blueFromToken(bluePart);
    if (!blue) return null;

    const tokens = redPart.split(/\s+/).filter(function (token) {
      return token && /\d/.test(token);
    });
    if (tokens.length < 4) return null;

    return buildSsqFromTokens(tokens, blue);
  }

  function buildSsqFromTokens(tokens, blue) {
    const reds = solveRedsFromTokens(tokens);
    if (reds) {
      const line = finalizeSsqLine(reds, blue);
      if (line) return line;
    }

    if (/^[1-5]\d{2}$/.test(String(tokens[0] || "").replace(/\D/g, ""))) {
      const tail = tokens.slice(1);
      const nums = [];
      tail.forEach(function (token) {
        const balls = ballsFromToken(token);
        if (balls.length === 1) nums.push(balls[0]);
      });
      if (nums.length === 5 && nums[0] === "04") {
        const recovered = ["03"].concat(nums);
        const line = finalizeSsqLine(recovered, blue);
        if (line) return line;
      }
    }

    return null;
  }

  function parseSsqLineWithoutPlus(chunk) {
    if (isSsqMetadataLine(chunk)) return null;

    const tokens = chunk.split(/\s+/).filter(function (token) {
      return token && /\d/.test(token);
    });
    if (tokens.length < 6) return null;

    for (let blueIdx = 6; blueIdx < Math.min(tokens.length, 10); blueIdx += 1) {
      const blue = blueFromToken(tokens[blueIdx]);
      if (!blue) continue;
      const line = buildSsqFromTokens(tokens.slice(0, blueIdx), blue);
      if (line) return line;
    }

    if (tokens.length >= 6) {
      const last = tokens[tokens.length - 1];
      const blue = blueFromToken(last);
      if (blue) {
        const head = tokens.slice(0, tokens.length - 1);
        const lastRedRaw = last.replace(/[.,].*$/, "").trim() || last;
        const line = buildSsqFromTokens(head.concat([lastRedRaw]), blue);
        if (line) return line;
      }
    }

    return null;
  }

  function parseSsqPlusLines(text) {
    const prepared = fixOcrText(text, true).replace(
      /(\d{1,2})\s*\.\s*(\d{1,2})(?=\s|$|[^\d])/g,
      function (_, redTail, blueRaw) {
        const blue = normalize2(blueRaw);
        return inRange(blue, 1, 16) ? redTail + " + " + blue : _;
      }
    );

    const lines = [];
    const plusRegex = /([^\n+]{8,120}?)\+([^\n]{0,20})/g;
    let match = plusRegex.exec(prepared);
    while (match) {
      const built = tryBuildSsqLine(match[1], match[2]);
      if (built) lines.push(built);
      match = plusRegex.exec(prepared);
    }

    prepared.split(/\n+/).forEach(function (chunk) {
      if (isSsqMetadataLine(chunk)) return;
      if (/\+/.test(chunk)) return;
      const built = parseSsqLineWithoutPlus(chunk);
      if (built) lines.push(built);
    });

    return uniqueKeepOrder(lines);
  }

  function inRange(num, min, max) {
    const value = parseInt(num, 10);
    return value >= min && value <= max;
  }

  function detectLotteryType(text) {
    if (/双色球|ssq/i.test(text)) return "ssq";
    if (/福彩\s*3\s*d|3d/i.test(text)) return "fcsd";
    if (/七乐彩|qlc/i.test(text)) return "qlc";
    if (/快乐\s*8|kl8|klb/i.test(text)) return "klb";
    return null;
  }

  function uniqueKeepOrder(nums) {
    const seen = new Set();
    const out = [];
    nums.forEach(function (n) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    });
    return out;
  }

  function isAscending(nums) {
    for (let i = 1; i < nums.length; i += 1) {
      if (parseInt(nums[i], 10) <= parseInt(nums[i - 1], 10)) return false;
    }
    return true;
  }

  function isValidSsqReds(reds) {
    if (reds.length !== 6) return false;
    const seen = new Set();
    for (let i = 0; i < reds.length; i += 1) {
      const n = reds[i];
      if (!inRange(n, 1, 33)) return false;
      if (seen.has(n)) return false;
      seen.add(n);
      if (i > 0 && parseInt(n, 10) <= parseInt(reds[i - 1], 10)) return false;
    }
    return true;
  }

  function isSsqMetadataLine(chunk) {
    return (
      /站号|流水|金额|销售|开奖|验票|贡献|福利|管理中心|玩法|复式|单式|倍数|期/.test(chunk) ||
      /^[A-F0-9-]{8,}/i.test(chunk.trim()) ||
      /^\d{4}\s*[\/年-]\s*\d{1,2}/.test(chunk.trim())
    );
  }

  function looksLikeSsqNumberLine(chunk) {
    if (isSsqMetadataLine(chunk)) return false;
    if (/\+/.test(chunk) && /\d/.test(chunk)) return true;
    const nums = extractBallTokens(chunk);
    return nums.length >= 7 && nums.length <= 16;
  }

  function parseSsqLineFromChunk(chunk) {
    const cleaned = chunk.trim();
    if (!cleaned) return null;

    if (/\+/.test(cleaned)) {
      const parts = cleaned.split(/\+/);
      if (parts.length >= 2) {
        const reds = extractNumbers(parts[0]).filter(function (n) {
          return inRange(n, 1, 33);
        });
        const blues = extractNumbers(parts.slice(1).join(" ")).filter(function (n) {
          return inRange(n, 1, 16);
        });
        if (reds.length >= 6 && blues.length >= 1) {
          const red6 = reds.slice(0, 6);
          const line = finalizeSsqLine(red6, blues[0]);
          if (line) return line;
        }
      }
    }

    const nums = extractNumbers(cleaned);
    for (let start = 0; start <= nums.length - 7; start += 1) {
      const reds = nums.slice(start, start + 6);
      const blue = nums[start + 6];
      const line = finalizeSsqLine(reds, blue);
      if (line) return line;
    }
    return null;
  }

  function parseSsqFromStream(text) {
    const lines = [];
    const nums = extractNumbers(text);
    let index = 0;

    while (index <= nums.length - 7) {
      const reds = nums.slice(index, index + 6);
      const blue = nums[index + 6];
      const line = finalizeSsqLine(reds, blue);
      if (line) {
        lines.push(line);
        index += 7;
      } else {
        index += 1;
      }
    }

    return uniqueKeepOrder(lines);
  }

  function parseSsqLines(text) {
    const plusLines = parseSsqPlusLines(text);
    if (plusLines.length) return plusLines;

    const lines = [];
    const chunks = text.split(/\n+/);

    chunks.forEach(function (chunk) {
      if (!looksLikeSsqNumberLine(chunk)) return;

      const direct = parseSsqLineFromChunk(chunk);
      if (direct) {
        lines.push(direct);
        return;
      }

      const nums = extractNumbers(chunk);
      let index = 0;
      while (index < nums.length) {
        const ticket = buildSsqTicket(nums, index);
        if (!ticket) {
          index += 1;
          continue;
        }
        lines.push(ticket.line);
        index = ticket.nextIndex;
      }
    });

    if (lines.length) return uniqueKeepOrder(lines);
    return parseSsqFromStream(text);
  }

  function buildSsqTicket(nums, start) {
    for (let size = 7; size <= Math.min(10, nums.length - start); size += 1) {
      const slice = nums.slice(start, start + size);
      if (slice.length < 7) break;

      for (let blueIndex = 6; blueIndex < slice.length; blueIndex += 1) {
        const blue = slice[blueIndex];
        if (!inRange(blue, 1, 16)) continue;

        const reds = uniqueKeepOrder(slice.slice(0, blueIndex).filter(function (n) {
          return inRange(n, 1, 33);
        }));

        if (!isValidSsqReds(reds)) {
          const recovered = recoverSsqRedsWithOcrFix(reds);
          if (!recovered) continue;
          reds.length = 0;
          recovered.forEach(function (n) {
            reds.push(n);
          });
        }
        const fixedBlue = recoverSsqBlueWithOcrFix(blue);
        if (!fixedBlue) continue;
        return {
          line: reds.join(" ") + " + " + fixedBlue,
          nextIndex: start + blueIndex + 1,
        };
      }
    }
    return null;
  }

  function parseFcsdLines(text) {
    const lines = [];
    const digitRuns = text.match(/\d{3,9}/g) || [];
    digitRuns.forEach(function (run) {
      if (run.length === 3) {
        lines.push(run);
        return;
      }
      for (let i = 0; i <= run.length - 3; i += 1) {
        lines.push(run.slice(i, i + 3));
      }
    });

    extractNumbers(text).forEach(function (_, idx, arr) {
      if (idx <= arr.length - 3) {
        lines.push(arr.slice(idx, idx + 3).join(""));
      }
    });

    return uniqueKeepOrder(lines.filter(function (line) {
      return /^\d{3}$/.test(line);
    }));
  }

  function parseQlcLines(text) {
    const lines = [];
    const nums = extractNumbers(text);
    let index = 0;
    while (index <= nums.length - 8) {
      let found = false;
      for (let specialIndex = 7; specialIndex < Math.min(nums.length - index, 10); specialIndex += 1) {
        const slice = nums.slice(index, index + specialIndex + 1);
        const special = slice[specialIndex];
        if (!inRange(special, 1, 30)) continue;
        const basic = uniqueKeepOrder(
          slice.slice(0, specialIndex).filter(function (n) {
            return inRange(n, 1, 30);
          })
        );
        if (basic.length !== 7) continue;
        lines.push(basic.join(" ") + " + " + special);
        index += specialIndex + 1;
        found = true;
        break;
      }
      if (!found) index += 1;
    }
    return uniqueKeepOrder(lines);
  }

  function parseKlbLines(text) {
    const lines = [];
    const playMatch = text.match(/选\s*(\d{1,2})/i);
    const playSize = playMatch ? Number(playMatch[1]) : null;
    const nums = uniqueKeepOrder(
      extractNumbers(text).filter(function (n) {
        return inRange(n, 1, 80);
      })
    );

    if (!nums.length) return lines;

    const size = playSize || nums.length;
    if (playSize) {
      for (let i = 0; i <= nums.length - size; i += size) {
        lines.push("选" + size + ": " + nums.slice(i, i + size).join(" "));
      }
      if (!lines.length) {
        lines.push("选" + size + ": " + nums.slice(0, size).join(" "));
      }
      return uniqueKeepOrder(lines);
    }

    if (nums.length <= 10) {
      lines.push("选" + nums.length + ": " + nums.join(" "));
    } else {
      for (let i = 0; i < nums.length; i += 10) {
        const chunk = nums.slice(i, i + 10);
        lines.push("选" + chunk.length + ": " + chunk.join(" "));
      }
    }
    return uniqueKeepOrder(lines);
  }

  function parseTextToLines(text, lotteryType) {
    const cleaned = fixOcrText(text, true);
    switch (lotteryType) {
      case "ssq":
        return parseSsqLines(cleaned);
      case "fcsd":
        return parseFcsdLines(cleaned);
      case "qlc":
        return parseQlcLines(cleaned);
      case "klb":
        return parseKlbLines(cleaned);
      default:
        return [];
    }
  }

  const MAX_IMAGE_EDGE = 1200;
  const MOBILE_MAX_IMAGE_EDGE = 960;
  const EDGE_MAX_IMAGE_EDGE = 640;
  const IMAGE_LOAD_TIMEOUT_MS = 15000;
  const PREPROCESS_STEP_TIMEOUT_MS = 20000;
  const CANVAS_ENCODE_TIMEOUT_MS = 12000;

  function getMaxImageEdge() {
    return isMobileLike() ? MOBILE_MAX_IMAGE_EDGE : MAX_IMAGE_EDGE;
  }

  function canvasToDataUrlAsync(canvas, timeoutMs) {
    timeoutMs = timeoutMs || CANVAS_ENCODE_TIMEOUT_MS;
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(
          new Error("图片编码超时（" + Math.round(timeoutMs / 1000) + " 秒）")
        );
      }, timeoutMs);

      if (typeof canvas.toBlob === "function") {
        canvas.toBlob(
          function (blob) {
            if (done) return;
            if (!blob) {
              done = true;
              clearTimeout(timer);
              reject(new Error("图片编码失败"));
              return;
            }
            var reader = new FileReader();
            reader.onload = function () {
              if (done) return;
              done = true;
              clearTimeout(timer);
              resolve(reader.result);
            };
            reader.onerror = function () {
              if (done) return;
              done = true;
              clearTimeout(timer);
              reject(new Error("图片读取失败"));
            };
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          0.82
        );
        return;
      }

      try {
        var url = canvas.toDataURL("image/jpeg", 0.82);
        done = true;
        clearTimeout(timer);
        resolve(url);
      } catch (err) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    });
  }

  function isEdgeBrowser() {
    return /EdgA|EdgiOS|Edg\//i.test(navigator.userAgent || "");
  }

  function isLowMemoryOcrMode() {
    return isEdgeBrowser();
  }

  function getMobileMaxImageEdge() {
    return isLowMemoryOcrMode() ? EDGE_MAX_IMAGE_EDGE : MOBILE_MAX_IMAGE_EDGE;
  }

  function isMobileLike() {
    const ua = navigator.userAgent || "";
    if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS|Windows Phone/i.test(ua)) {
      return true;
    }
    if (/EdgA|EdgiOS|Edge\//i.test(ua) && /Mobile|Mobi/i.test(ua)) {
      return true;
    }
    if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) {
      return true;
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      (window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(max-width: 900px)").matches)
    ) {
      return true;
    }
    return false;
  }

  function shouldUsePerspectiveCorrection() {
    return !isMobileLike();
  }

  function loadOpenCV() {
    if (global.cv && global.cv.imread) return Promise.resolve(global.cv);
    if (global.__lotteryOpenCvPromise) return global.__lotteryOpenCvPromise;

    return new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "./opencv-loader.js";
      script.async = true;
      script.onload = function () {
        const load =
          typeof global.__lotteryLoadOpenCv === "function"
            ? global.__lotteryLoadOpenCv()
            : global.__lotteryOpenCvPromise;
        if (!load) {
          reject(new Error("OpenCV 加载器启动失败"));
          return;
        }
        load.then(resolve, reject);
      };
      script.onerror = function () {
        reject(new Error("OpenCV 加载失败"));
      };
      document.head.appendChild(script);
    });
  }

  function createScaledCanvas(img) {
    return createScaledCanvasFromSource(img);
  }

  function createScaledCanvasFromSource(source) {
    const maxEdge = getMaxImageEdge();
    const srcW = source.width;
    const srcH = source.height;
    const scale = Math.min(1, maxEdge / srcW, maxEdge / srcH);
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
  }

  function yieldToMain() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
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

  async function loadImageFromFile(file, report) {
    report(4, "正在读取图片...");

    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await withTimeout(
          createImageBitmap(file, {
            resizeWidth: getMaxImageEdge(),
            resizeHeight: getMaxImageEdge(),
            resizeQuality: "high",
          }),
          IMAGE_LOAD_TIMEOUT_MS,
          "图片读取超时，请换一张较小的照片"
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        if (typeof bitmap.close === "function") bitmap.close();
        return canvas;
      } catch (_) {
        /* fallback to FileReader */
      }
    }

    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      const timeout = setTimeout(function () {
        reject(new Error("图片读取超时，请换一张较小的照片"));
      }, IMAGE_LOAD_TIMEOUT_MS);

      reader.onerror = function () {
        clearTimeout(timeout);
        reject(new Error("读取图片失败"));
      };
      reader.onload = function () {
        const img = new Image();
        img.onload = function () {
          clearTimeout(timeout);
          resolve(createScaledCanvas(img));
        };
        img.onerror = function () {
          clearTimeout(timeout);
          reject(new Error("图片格式不支持"));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function rotateCanvas(source, angleDeg) {
    if (!angleDeg) return source;
    const rad = (angleDeg * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const w = source.width;
    const h = source.height;
    const nw = Math.max(1, Math.ceil(w * cos + h * sin));
    const nh = Math.max(1, Math.ceil(w * sin + h * cos));
    const canvas = document.createElement("canvas");
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, nw, nh);
    ctx.translate(nw / 2, nh / 2);
    ctx.rotate(rad);
    ctx.drawImage(source, -w / 2, -h / 2);
    return canvas;
  }

  function estimateSkewAngle(sourceCanvas) {
    const sampleW = 420;
    const scale = Math.min(1, sampleW / sourceCanvas.width);
    const w = Math.max(1, Math.round(sourceCanvas.width * scale));
    const h = Math.max(1, Math.round(sourceCanvas.height * scale));
    const sample = document.createElement("canvas");
    sample.width = w;
    sample.height = h;
    sample.getContext("2d").drawImage(sourceCanvas, 0, 0, w, h);
    const pixels = sample.getContext("2d").getImageData(0, 0, w, h).data;
    const binary = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      binary[p] = gray < 150 ? 1 : 0;
    }

    function score(angle) {
      const rad = (angle * Math.PI) / 180;
      const sin = Math.sin(rad);
      const cos = Math.cos(rad);
      const bins = new Uint32Array(h);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          if (!binary[y * w + x]) continue;
          const yr = Math.round(x * sin + y * cos);
          if (yr >= 0 && yr < h) bins[yr] += 1;
        }
      }
      let mean = 0;
      for (let i = 0; i < h; i += 1) mean += bins[i];
      mean /= h;
      let variance = 0;
      for (let i = 0; i < h; i += 1) {
        const diff = bins[i] - mean;
        variance += diff * diff;
      }
      return variance;
    }

    let bestAngle = 0;
    let bestScore = 0;
    for (let angle = -20; angle <= 20; angle += 1) {
      const current = score(angle);
      if (current > bestScore) {
        bestScore = current;
        bestAngle = angle;
      }
    }
    return Math.abs(bestAngle) >= 0.8 ? bestAngle : 0;
  }

  function deskewCanvas(sourceCanvas) {
    const angle = estimateSkewAngle(sourceCanvas);
    return angle ? rotateCanvas(sourceCanvas, angle) : sourceCanvas;
  }

  function distPoint(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function orderQuadPoints(points) {
    const sorted = points.slice().sort(function (a, b) {
      return a.y - b.y;
    });
    const top = sorted.slice(0, 2).sort(function (a, b) {
      return a.x - b.x;
    });
    const bottom = sorted.slice(2, 4).sort(function (a, b) {
      return a.x - b.x;
    });
    return [top[0], top[1], bottom[1], bottom[0]];
  }

  function tryPerspectiveCorrect(sourceCanvas, cv) {
    const srcMat = cv.imread(sourceCanvas);
    const gray = new cv.Mat();
    const blur = new cv.Mat();
    const edges = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let outCanvas = null;

    try {
      cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.Canny(blur, edges, 40, 140);

      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      const imageArea = sourceCanvas.width * sourceCanvas.height;
      let bestQuad = null;
      let bestArea = 0;

      for (let i = 0; i < contours.size(); i += 1) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        if (area < imageArea * 0.18 || area > imageArea * 0.96) continue;

        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);
        if (approx.rows === 4 && area > bestArea) {
          const points = [];
          for (let j = 0; j < 4; j += 1) {
            points.push({
              x: approx.data32S[j * 2],
              y: approx.data32S[j * 2 + 1],
            });
          }
          bestArea = area;
          bestQuad = points;
        }
        approx.delete();
      }

      if (!bestQuad) return null;

      const ordered = orderQuadPoints(bestQuad);
      const widthTop = distPoint(ordered[0], ordered[1]);
      const widthBottom = distPoint(ordered[3], ordered[2]);
      const maxWidth = Math.max(1, Math.round(Math.max(widthTop, widthBottom)));
      const heightLeft = distPoint(ordered[0], ordered[3]);
      const heightRight = distPoint(ordered[1], ordered[2]);
      const maxHeight = Math.max(1, Math.round(Math.max(heightLeft, heightRight)));

      const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        ordered[0].x,
        ordered[0].y,
        ordered[1].x,
        ordered[1].y,
        ordered[2].x,
        ordered[2].y,
        ordered[3].x,
        ordered[3].y,
      ]);
      const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        maxWidth - 1,
        0,
        maxWidth - 1,
        maxHeight - 1,
        0,
        maxHeight - 1,
      ]);
      const transform = cv.getPerspectiveTransform(srcTri, dstTri);
      const dst = new cv.Mat();
      cv.warpPerspective(srcMat, dst, transform, new cv.Size(maxWidth, maxHeight));

      outCanvas = document.createElement("canvas");
      outCanvas.width = maxWidth;
      outCanvas.height = maxHeight;
      cv.imshow(outCanvas, dst);

      srcTri.delete();
      dstTri.delete();
      transform.delete();
      dst.delete();
    } finally {
      srcMat.delete();
      gray.delete();
      blur.delete();
      edges.delete();
      contours.delete();
      hierarchy.delete();
    }

    return outCanvas;
  }

  async function prepareTicketCanvas(source, report) {
    let base =
      source.width > getMaxImageEdge() || source.height > getMaxImageEdge()
        ? createScaledCanvasFromSource(source)
        : source;

    if (isMobileLike()) {
      report(32, "手机模式：跳过角度校正，继续识别...");
      return base;
    }

    report(10, "正在校正拍摄角度...");
    await yieldToMain();
    try {
      base = deskewCanvas(base);
    } catch (_) {
      /* deskew failed, use original */
    }

    if (shouldUsePerspectiveCorrection()) {
      try {
        report(16, "正在尝试透视校正...");
        const cv = await withTimeout(
          loadOpenCV(),
          PREPROCESS_STEP_TIMEOUT_MS,
          "OpenCV 加载超时"
        );
        report(24, "正在拉平票面...");
        await yieldToMain();
        const warped = tryPerspectiveCorrect(base, cv);
        if (warped) base = warped;
        report(32, "透视校正完成");
      } catch (_) {
        report(32, "透视校正跳过，继续识别...");
      }
    } else {
      report(32, "继续识别...");
    }

    return base;
  }

  async function loadImageToCanvas(file, maxEdge) {
    if (typeof createImageBitmap === "function") {
      const bitmap = await withTimeout(
        createImageBitmap(file, {
          resizeWidth: maxEdge,
          resizeHeight: maxEdge,
          resizeQuality: "medium",
        }),
        IMAGE_LOAD_TIMEOUT_MS,
        "图片读取超时，请换一张较小的照片"
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      if (typeof bitmap.close === "function") bitmap.close();
      return canvas;
    }
    return loadImageFromFile(file, function () {});
  }

  async function buildMobilePreprocessResult(canvas, lotteryType, report) {
    let ssqStrips = [];
    const variants = [];

    if (lotteryType === "ssq" && isLowMemoryOcrMode()) {
      pulseProgress(report, 10, "Edge 模式：分析号码行...");
      await yieldToMain();
      ssqStrips = extractSsqLayoutRowStrips(canvas).map(function (strip) {
        return {
          id: strip.id,
          dataUrl: strip.dataUrl,
          dataUrls: strip.dataUrls || [strip.dataUrl],
          source: strip.source || "layout",
        };
      });

      const zone = cropSsqNumberZoneFast(canvas);
      const scale = Math.min(1.6, 640 / Math.max(zone.width, zone.height));
      const zoneScaled = scale > 1 ? scaleCanvas(zone, scale) : zone;
      pulseProgress(report, 12, "编码识别图...");
      await yieldToMain();
      const fallbackUrl = await canvasToDataUrlAsync(
        zoneScaled,
        CANVAS_ENCODE_TIMEOUT_MS
      );
      pulseProgress(report, 14, "图片就绪，正在加载 OCR...");
      return {
        previewUrl: fallbackUrl,
        variants: [{ id: "edge-fallback-zone", dataUrl: fallbackUrl }],
        ssqStrips: ssqStrips,
        edgeLite: true,
      };
    }

    if (lotteryType === "ssq") {
      pulseProgress(report, 10, "分析号码行布局...");
      await yieldToMain();
      ssqStrips = extractSsqRowStripsFromCanvas(canvas).map(function (strip) {
        return {
          id: strip.id,
          dataUrl: strip.dataUrl,
          dataUrls: strip.dataUrls || [strip.dataUrl],
          source: strip.source || "layout",
        };
      });

      const zone = cropSsqNumberZoneFast(canvas);
      const scale = Math.min(2.2, 960 / Math.max(zone.width, zone.height));
      const zoneScaled = scale > 1 ? scaleCanvas(zone, scale) : zone;
      const contrast = renderVariant(
        zoneScaled,
        0,
        0,
        zoneScaled.width,
        zoneScaled.height,
        "contrast"
      );

      pulseProgress(report, 12, "编码识别图...");
      await yieldToMain();
      variants.push({
        id: "mobile-zone",
        dataUrl: await canvasToDataUrlAsync(zoneScaled, CANVAS_ENCODE_TIMEOUT_MS),
      });
      if (!isLowMemoryOcrMode()) {
        variants.push({
          id: "mobile-zone-contrast",
          dataUrl: await canvasToDataUrlAsync(contrast, CANVAS_ENCODE_TIMEOUT_MS),
        });
      }
    } else {
      pulseProgress(report, 10, "裁剪号码区...");
      await yieldToMain();
      variants.push({
        id: "mobile-fast",
        dataUrl: await canvasToDataUrlAsync(canvas, CANVAS_ENCODE_TIMEOUT_MS),
      });
    }

    const previewUrl = variants[0]
      ? variants[0].dataUrl
      : await canvasToDataUrlAsync(canvas, CANVAS_ENCODE_TIMEOUT_MS);
    pulseProgress(report, 14, "图片就绪，正在加载 OCR...");
    return {
      previewUrl: previewUrl,
      variants: variants,
      ssqStrips: ssqStrips,
    };
  }

  async function preprocessImageMobile(file, report, lotteryType) {
    pulseProgress(report, 4, "正在读取图片...");
    await yieldToMain();
    const canvas = await loadImageToCanvas(file, getMobileMaxImageEdge());
    pulseProgress(report, 8, "正在编码图片...");
    await yieldToMain();
    return buildMobilePreprocessResult(canvas, lotteryType, report);
  }

  async function preprocessImage(file, report, lotteryType) {
    if (isMobileLike()) {
      return preprocessImageMobile(file, report, lotteryType);
    }
    const scaled = await loadImageFromFile(file, report);
    pulseProgress(report, 6, "正在预处理图片...");
    await yieldToMain();
    const base = await prepareTicketCanvas(scaled, report);
    pulseProgress(report, 34, "预处理完成");
    await yieldToMain();
    pulseProgress(report, 35, "正在分析号码区域...");
    await yieldToMain();
    return buildPreprocessVariantsFromCanvasAsync(base, lotteryType, report);
  }

  function pulseProgress(report, percent, message) {
    report(percent, message);
    global.__ocrLastProgressAt = Date.now();
    global.__ocrLastProgressMsg = message;
  }

  function cropSsqNumberZoneFast(base) {
    const w = base.width;
    const h = base.height;
    return cropCanvasRegion(
      base,
      Math.round(w * SSQ_LAYOUT.fallbackLeft),
      Math.round(h * SSQ_LAYOUT.fallbackTop),
      Math.round(w * (SSQ_LAYOUT.fallbackRight - SSQ_LAYOUT.fallbackLeft)),
      Math.round(h * (SSQ_LAYOUT.fallbackBottom - SSQ_LAYOUT.fallbackTop))
    );
  }

  async function buildPreprocessVariantsFromCanvasAsync(base, lotteryType, report) {
    if (isMobileLike()) {
      pulseProgress(report, 36, "手机模式：准备识别图...");
      await yieldToMain();
      const maxEdge = getMobileMaxImageEdge();
      const scale = Math.min(1, maxEdge / Math.max(base.width, base.height));
      const small = scale < 1 ? scaleCanvas(base, scale) : base;
      await yieldToMain();
      return buildMobilePreprocessResult(small, lotteryType, report);
    }

    pulseProgress(report, 36, "正在分析票面布局...");
    await yieldToMain();
    return buildPreprocessVariantsFromCanvas(base, lotteryType);
  }

  function canvasToDataUrl(canvas) {
    return canvas.toDataURL("image/jpeg", 0.92);
  }

  function cropCanvasRegion(source, sx, sy, sw, sh) {
    const width = Math.max(1, Math.round(sw));
    const height = Math.max(1, Math.round(sh));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
    return canvas;
  }

  function scaleCanvas(source, factor) {
    const width = Math.max(1, Math.round(source.width * factor));
    const height = Math.max(1, Math.round(source.height * factor));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
  }

  function isSsqRedBallPixel(r, g, b) {
    return r > 90 && r - g > 28 && r - b > 28 && g < 145 && b < 145;
  }

  function isSsqBlueBallPixel(r, g, b) {
    return b > 75 && b - r > 18 && b - g > 8 && r < 130 && g < 160;
  }

  function findBallClusters(canvas, isBallPixel, opts) {
    opts = opts || {};
    const minArea = opts.minArea || 55;
    const maxArea = opts.maxArea || 14000;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const pixels = ctx.getImageData(0, 0, w, h).data;
    const seen = new Uint8Array(w * h);
    const clusters = [];

    function idx(x, y) {
      return y * w + x;
    }

    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const id = idx(x, y);
        if (seen[id]) continue;
        const pi = id * 4;
        if (!isBallPixel(pixels[pi], pixels[pi + 1], pixels[pi + 2])) continue;

        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let area = 0;
        const stack = [[x, y]];
        seen[id] = 1;

        while (stack.length) {
          const point = stack.pop();
          const cx = point[0];
          const cy = point[1];
          area += 1;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          const neighbors = [
            [cx + 1, cy],
            [cx - 1, cy],
            [cx, cy + 1],
            [cx, cy - 1],
          ];
          for (let n = 0; n < neighbors.length; n += 1) {
            const nx = neighbors[n][0];
            const ny = neighbors[n][1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = idx(nx, ny);
            if (seen[ni]) continue;
            const npi = ni * 4;
            if (!isBallPixel(pixels[npi], pixels[npi + 1], pixels[npi + 2])) continue;
            seen[ni] = 1;
            stack.push([nx, ny]);
          }
        }

        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const aspect = bw / Math.max(1, bh);
        if (
          area >= minArea &&
          area <= maxArea &&
          bw >= 6 &&
          bh >= 6 &&
          aspect >= 0.4 &&
          aspect <= 2.4
        ) {
          clusters.push({
            minX: minX,
            minY: minY,
            maxX: maxX,
            maxY: maxY,
            cx: (minX + maxX) / 2,
            cy: (minY + maxY) / 2,
            area: area,
          });
        }
      }
    }

    return clusters;
  }

  function dedupeNearbyClusters(clusters, minDist) {
    const sorted = clusters.slice().sort(function (a, b) {
      return a.cx - b.cx || a.cy - b.cy;
    });
    const out = [];
    sorted.forEach(function (cluster) {
      const dup = out.find(function (existing) {
        return Math.hypot(existing.cx - cluster.cx, existing.cy - cluster.cy) < minDist;
      });
      if (!dup || cluster.area > dup.area) {
        if (dup) {
          const index = out.indexOf(dup);
          out[index] = cluster;
        } else {
          out.push(cluster);
        }
      }
    });
    return out;
  }

  function groupSsqBetRows(redClusters, blueClusters) {
    if (!redClusters.length) return [];

    const sorted = redClusters.slice().sort(function (a, b) {
      return a.cy - b.cy || a.cx - b.cx;
    });
    const rows = [];
    let current = [sorted[0]];
    let rowCy = sorted[0].cy;

    for (let i = 1; i < sorted.length; i += 1) {
      const cluster = sorted[i];
      const avgH =
        current.reduce(function (sum, item) {
          return sum + (item.maxY - item.minY + 1);
        }, 0) / current.length;
      if (Math.abs(cluster.cy - rowCy) <= Math.max(12, avgH * 0.75)) {
        current.push(cluster);
        rowCy =
          current.reduce(function (sum, item) {
            return sum + item.cy;
          }, 0) / current.length;
      } else {
        rows.push(current);
        current = [cluster];
        rowCy = cluster.cy;
      }
    }
    rows.push(current);

    return rows
      .map(function (reds) {
        reds.sort(function (a, b) {
          return a.cx - b.cx;
        });
        reds = dedupeNearbyClusters(
          reds,
          Math.max(8, (reds[0].maxX - reds[0].minX + 1) * 0.75)
        );
        if (reds.length < 4) return null;

        const rowCy =
          reds.reduce(function (sum, item) {
            return sum + item.cy;
          }, 0) / reds.length;
        const rowH =
          reds.reduce(function (sum, item) {
            return sum + (item.maxY - item.minY + 1);
          }, 0) / reds.length;
        let blue = null;
        let bestScore = Infinity;

        blueClusters.forEach(function (candidate) {
          const dy = Math.abs(candidate.cy - rowCy);
          const dx = candidate.cx - reds[reds.length - 1].cx;
          if (dy > rowH * 1.1) return;
          const score = dy * 4 + Math.max(0, 20 - dx) * 0.15;
          if (score < bestScore) {
            bestScore = score;
            blue = candidate;
          }
        });

        return { reds: reds, blue: blue };
      })
      .filter(Boolean);
  }

  function cropSsqBetRowStrip(source, row, padFactor) {
    const balls = row.reds.slice();
    if (row.blue) balls.push(row.blue);
    const pad = Math.max(
      6,
      Math.round(
        (balls.reduce(function (sum, ball) {
          return sum + (ball.maxX - ball.minX + 1);
        }, 0) /
          balls.length) *
          (padFactor || 0.35)
      )
    );

    let minX = balls[0].minX;
    let maxX = balls[0].maxX;
    let minY = balls[0].minY;
    let maxY = balls[0].maxY;
    balls.forEach(function (ball) {
      minX = Math.min(minX, ball.minX);
      maxX = Math.max(maxX, ball.maxX);
      minY = Math.min(minY, ball.minY);
      maxY = Math.max(maxY, ball.maxY);
    });

    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(source.width - 1, maxX + pad);
    maxY = Math.min(source.height - 1, maxY + pad);

    const crop = cropCanvasRegion(source, minX, minY, maxX - minX + 1, maxY - minY + 1);
    return scaleCanvas(crop, 2.4);
  }

  function extractSsqRowStripsFromCanvas(base) {
    const layoutStrips = extractSsqLayoutRowStrips(base);
    if (layoutStrips.length) return layoutStrips;

    const top = Math.round(base.height * 0.2);
    const height = Math.round(base.height * 0.72);
    const zone = cropCanvasRegion(base, 0, top, base.width, height);
    const scale = zone.width < 900 ? 900 / zone.width : 1;
    const work = scale > 1 ? scaleCanvas(zone, scale) : zone;

    const redClusters = dedupeNearbyClusters(
      findBallClusters(work, isSsqRedBallPixel, { minArea: 50, maxArea: 16000 }),
      10
    );
    const blueClusters = dedupeNearbyClusters(
      findBallClusters(work, isSsqBlueBallPixel, { minArea: 40, maxArea: 12000 }),
      10
    );
    const rows = groupSsqBetRows(redClusters, blueClusters);

    return rows
      .map(function (row, index) {
        const canvas = cropSsqBetRowStrip(work, row);
        const contrast = renderVariant(
          canvas,
          0,
          0,
          canvas.width,
          canvas.height,
          "contrast"
        );
        const encoded = encodeSsqStrip({ raw: canvas, contrast: contrast });
        return {
          id: "ssq-color-row-" + index,
          dataUrl: encoded.dataUrl,
          dataUrls: encoded.dataUrls,
          canvas: contrast,
          source: "color",
        };
      })
      .filter(function (item) {
        return item.canvas.width >= 80 && item.canvas.height >= 18;
      });
  }

  function cropSsqNumberZone(base) {
    const bounds = findSsqNumberZoneBounds(base);
    return cropCanvasRegion(
      base,
      bounds.left,
      bounds.top,
      bounds.right - bounds.left,
      bounds.bottom - bounds.top
    );
  }

  const SSQ_LAYOUT = {
    fallbackTop: 0.36,
    fallbackBottom: 0.74,
    fallbackLeft: 0.08,
    fallbackRight: 0.97,
    defaultRows: 5,
    stripScale: 2.6,
    mobileStripScale: 3.4,
    edgeStripScale: 2.8,
  };

  function getStripScale() {
    if (isLowMemoryOcrMode()) return SSQ_LAYOUT.edgeStripScale;
    return isMobileLike() ? SSQ_LAYOUT.mobileStripScale : SSQ_LAYOUT.stripScale;
  }

  function rowTextScore(canvas, yStart, yEnd, xStart, xEnd) {
    const w = canvas.width;
    const pixels = canvas.getContext("2d").getImageData(0, 0, w, canvas.height).data;
    let darkCount = 0;
    let edges = 0;
    let prevDark = false;

    for (let y = yStart; y < yEnd; y += 1) {
      prevDark = false;
      for (let x = xStart; x < xEnd; x += 1) {
        const idx = (y * w + x) * 4;
        const gray =
          0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
        const dark = gray < 155;
        if (dark) darkCount += 1;
        if (dark !== prevDark) edges += 1;
        prevDark = dark;
      }
    }

    return darkCount + edges * 0.35;
  }

  function smoothRowScores(scores, radius) {
    const out = new Float32Array(scores.length);
    for (let y = 0; y < scores.length; y += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny >= 0 && ny < scores.length) {
          sum += scores[ny];
          count += 1;
        }
      }
      out[y] = sum / count;
    }
    return out;
  }

  function findSsqNumberZoneBounds(canvas) {
    const w = canvas.width;
    const h = canvas.height;
    const xStart = Math.round(w * 0.04);
    const xEnd = Math.round(w * 0.96);
    const scanStart = Math.round(h * 0.24);
    const scanEnd = Math.round(h * 0.82);
    const scores = new Float32Array(h);

    for (let y = scanStart; y < scanEnd; y += 1) {
      scores[y] = rowTextScore(canvas, y, y + 1, xStart, xEnd);
    }

    const smooth = smoothRowScores(scores, 6);
    const sample = [];
    for (let y = scanStart; y < scanEnd; y += 1) {
      sample.push(smooth[y]);
    }
    sample.sort(function (a, b) {
      return a - b;
    });
    const threshold = sample[Math.floor(sample.length * 0.42)] || 0;

    let top = Math.round(h * SSQ_LAYOUT.fallbackTop);
    let bottom = Math.round(h * SSQ_LAYOUT.fallbackBottom);

    for (let y = scanStart; y < scanEnd; y += 1) {
      if (smooth[y] > threshold * 0.82) {
        top = y;
        break;
      }
    }
    for (let y = scanEnd - 1; y >= scanStart; y -= 1) {
      if (smooth[y] > threshold * 0.82) {
        bottom = y;
        break;
      }
    }

    if (bottom - top < h * 0.07) {
      top = Math.round(h * SSQ_LAYOUT.fallbackTop);
      bottom = Math.round(h * SSQ_LAYOUT.fallbackBottom);
    }

    return {
      top: top,
      bottom: bottom,
      left: Math.round(w * SSQ_LAYOUT.fallbackLeft),
      right: Math.round(w * SSQ_LAYOUT.fallbackRight),
    };
  }

  function splitSsqRowsInBounds(canvas, bounds) {
    const zoneHeight = bounds.bottom - bounds.top;
    const xStart = bounds.left;
    const xEnd = bounds.right;
    const scores = new Float32Array(zoneHeight);
    const rowThreshold = Math.max(12, (xEnd - xStart) * 0.012);

    for (let y = 0; y < zoneHeight; y += 1) {
      scores[y] = rowTextScore(canvas, bounds.top + y, bounds.top + y + 1, xStart, xEnd);
    }

    const smooth = smoothRowScores(scores, 4);
    const rows = [];
    let inRow = false;
    let rowStart = 0;

    for (let y = 0; y < zoneHeight; y += 1) {
      if (smooth[y] > rowThreshold) {
        if (!inRow) {
          rowStart = y;
          inRow = true;
        }
      } else if (inRow) {
        const rowHeight = y - rowStart;
        if (rowHeight >= zoneHeight * 0.045) {
          rows.push({ y: rowStart, h: rowHeight });
        }
        inRow = false;
      }
    }

    if (inRow) {
      const rowHeight = zoneHeight - rowStart;
      if (rowHeight >= zoneHeight * 0.045) {
        rows.push({ y: rowStart, h: rowHeight });
      }
    }

    if (rows.length >= 1 && rows.length <= 5) {
      return rows;
    }

    const count = SSQ_LAYOUT.defaultRows;
    const rowH = zoneHeight / count;
    const equalRows = [];
    for (let i = 0; i < count; i += 1) {
      equalRows.push({ y: Math.round(i * rowH), h: Math.round((i + 1) * rowH) - Math.round(i * rowH) });
    }
    return equalRows;
  }

  function prepareSsqStripCanvas(source, sx, sy, sw, sh) {
    const padY = Math.max(2, Math.round(sh * 0.12));
    const crop = cropCanvasRegion(
      source,
      sx,
      Math.max(0, sy - padY),
      sw,
      sh + padY * 2
    );
    const scaled = scaleCanvas(crop, getStripScale());
    const contrast = renderVariant(
      scaled,
      0,
      0,
      scaled.width,
      scaled.height,
      "contrast"
    );
    return {
      raw: scaled,
      contrast: contrast,
    };
  }

  function encodeSsqStrip(stripCanvases) {
    const contrastUrl = canvasToDataUrl(stripCanvases.contrast);
    if (isLowMemoryOcrMode()) {
      return {
        dataUrl: contrastUrl,
        dataUrls: [contrastUrl],
      };
    }
    return {
      dataUrl: contrastUrl,
      dataUrls: [contrastUrl, canvasToDataUrl(stripCanvases.raw)],
    };
  }

  function releasePreparedImages(prepared) {
    if (!prepared) return;
    if (prepared.ssqStrips) {
      prepared.ssqStrips.forEach(function (strip) {
        strip.dataUrl = null;
        strip.dataUrls = null;
      });
    }
    if (prepared.variants) {
      prepared.variants.forEach(function (variant) {
        variant.dataUrl = null;
      });
    }
    prepared.previewUrl = null;
  }

  function extractSsqLayoutRowStrips(base) {
    const bounds = findSsqNumberZoneBounds(base);
    const rows = splitSsqRowsInBounds(base, bounds);
    const zoneWidth = bounds.right - bounds.left;

    return rows
      .map(function (row, index) {
        const canvases = prepareSsqStripCanvas(
          base,
          bounds.left,
          bounds.top + row.y,
          zoneWidth,
          row.h
        );
        const encoded = encodeSsqStrip(canvases);
        return {
          id: "ssq-layout-row-" + index,
          dataUrl: encoded.dataUrl,
          dataUrls: encoded.dataUrls,
          canvas: canvases.contrast,
          source: "layout",
        };
      })
      .filter(function (item) {
        return item.canvas.width >= 80 && item.canvas.height >= 16;
      });
  }

  function parseSsqStripFromItems(items) {
    if (!items || !items.length) return null;
    const sorted = items.slice().sort(function (a, b) {
      const ax =
        a.poly.reduce(function (s, p) {
          return s + p.x;
        }, 0) / a.poly.length;
      const ay =
        a.poly.reduce(function (s, p) {
          return s + p.y;
        }, 0) / a.poly.length;
      const bx =
        b.poly.reduce(function (s, p) {
          return s + p.x;
        }, 0) / b.poly.length;
      const by =
        b.poly.reduce(function (s, p) {
          return s + p.y;
        }, 0) / b.poly.length;
      if (Math.abs(ay - by) < 8) return ax - bx;
      return ay - by || ax - bx;
    });
    const text = sorted
      .map(function (item) {
        return item.text || "";
      })
      .join(" ");
    return parseSsqStripText(text);
  }

  function scoreSsqParsedLine(line) {
    if (!line) return -1;
    const parts = line.split(" + ");
    if (parts.length !== 2) return 0;
    const reds = parts[0].split(/\s+/).filter(Boolean);
    const blue = parts[1];
    if (reds.length !== 6) return reds.length;
    if (!inRange(blue, 1, 16)) return 5;
    return 10 + (isValidSsqReds(reds) ? 4 : 0);
  }

  async function recognizeSsqStripBest(strip) {
    const urls = strip.dataUrls || [strip.dataUrl];
    let best = null;
    let bestScore = -1;

    for (let u = 0; u < urls.length; u += 1) {
      const result = await recognizeDataUrl(urls[u]);
      const candidates = [];
      const fromText = parseSsqStripText(result.text || "");
      if (fromText) candidates.push(fromText);
      const fromItems = parseSsqStripFromItems(result.items || []);
      if (fromItems && candidates.indexOf(fromItems) === -1) {
        candidates.push(fromItems);
      }

      for (let c = 0; c < candidates.length; c += 1) {
        const score = scoreSsqParsedLine(candidates[c]);
        if (score > bestScore) {
          bestScore = score;
          best = candidates[c];
        }
      }
    }

    return best;
  }

  function parseSsqStripText(text) {
    const cleaned = fixOcrText(text, false)
      .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/u, "")
      .replace(/^\d{1,2}\s+(?=\d{2})/, "")
      .trim();
    if (!cleaned) return null;

    const plusFixed = cleaned.replace(
      /(\d{1,2})\s+(\d{1,2})\s*$/,
      function (match, redTail, maybeBlue) {
        if (inRange(maybeBlue, 1, 16) && inRange(redTail, 1, 33)) {
          return redTail + " + " + normalize2(maybeBlue);
        }
        return match;
      }
    );

    const direct = parseSsqLineFromChunk(plusFixed);
    if (direct) return direct;

    const withoutPlus = parseSsqLineWithoutPlus(plusFixed);
    if (withoutPlus) return withoutPlus;

    const nums = extractNumbers(plusFixed.replace(/\+/g, " "));
    if (nums.length >= 7) {
      const line = finalizeSsqLine(nums.slice(0, 6), nums[6]);
      if (line) return line;
    }

    return null;
  }

  const SSQ_DIGIT_CONFUSIONS = {
    "0": ["8", "6", "9"],
    "1": ["7", "4"],
    "2": ["7"],
    "3": ["8", "5", "9"],
    "5": ["6", "9"],
    "6": ["8", "5", "0"],
    "7": ["1", "2"],
    "8": ["3", "6", "0", "9"],
    "9": ["8", "4"],
  };

  function ssqDigitCandidates(num, maxRange) {
    const raw = normalize2(num);
    const out = [raw];
    const chars = raw.split("");
    if (chars.length !== 2) return out;

    for (let i = 0; i < chars.length; i += 1) {
      const alts = SSQ_DIGIT_CONFUSIONS[chars[i]] || [];
      for (let j = 0; j < alts.length; j += 1) {
        const next = chars.slice();
        next[i] = alts[j];
        const candidate = normalize2(next.join(""));
        if (inRange(candidate, 1, maxRange) && out.indexOf(candidate) === -1) {
          out.push(candidate);
        }
      }
    }
    return out;
  }

  function recoverSsqRedsWithOcrFix(reds) {
    if (reds.length !== 6) return null;
    if (isValidSsqReds(reds)) return reds.slice();

    const options = reds.map(function (num) {
      return ssqDigitCandidates(num, 33);
    });

    function dfs(idx, path) {
      if (idx === 6) {
        return isValidSsqReds(path) ? path.slice() : null;
      }
      const choices = options[idx];
      for (let i = 0; i < choices.length; i += 1) {
        const n = choices[i];
        if (path.length && parseInt(n, 10) <= parseInt(path[path.length - 1], 10)) continue;
        if (path.indexOf(n) !== -1) continue;
        path.push(n);
        const found = dfs(idx + 1, path);
        if (found) return found;
        path.pop();
      }
      return null;
    }

    return dfs(0, []);
  }

  function recoverSsqBlueWithOcrFix(blue) {
    if (!blue) return null;
    const candidates = ssqDigitCandidates(blue, 16);
    for (let i = 0; i < candidates.length; i += 1) {
      if (inRange(candidates[i], 1, 16)) return candidates[i];
    }
    return inRange(blue, 1, 16) ? normalize2(blue) : null;
  }

  function finalizeSsqLine(reds, blue) {
    const fixedReds = recoverSsqRedsWithOcrFix(reds.map(normalize2));
    const fixedBlue = recoverSsqBlueWithOcrFix(blue);
    if (!fixedReds || !fixedBlue) return null;
    return fixedReds.join(" ") + " + " + fixedBlue;
  }

  function mergeSsqLineSources(stripLines, ocrLines, stripVotes, ocrVotes) {
    const ordered = [];
    const seen = new Set();

    function addLine(line, score) {
      if (!line || seen.has(line)) return;
      seen.add(line);
      ordered.push({ line: line, score: score });
    }

    stripLines.forEach(function (line) {
      addLine(line, (stripVotes[line] || 0) + 5);
    });
    ocrLines.forEach(function (line) {
      addLine(line, (ocrVotes[line] || 0) + (stripVotes[line] ? 2 : 0));
    });

    return ordered
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return stripLines.indexOf(a.line) - stripLines.indexOf(b.line);
      })
      .slice(0, 5)
      .map(function (item) {
        return item.line;
      })
      .sort(function (a, b) {
        const ai = stripLines.indexOf(a);
        const bi = stripLines.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return ocrLines.indexOf(a) - ocrLines.indexOf(b);
      });
  }

  function applyContrastEnhancement(imageData) {
    const pixels = imageData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      let value = (gray - 110) * 1.85 + 128;
      value = 128 + (value - 128) * 1.12;
      value = Math.min(255, Math.max(0, value));
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
    }
  }

  function applyAdaptiveThreshold(imageData, width, height) {
    const pixels = imageData.data;
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
      gray[p] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    }

    const block = 15;
    const half = Math.floor(block / 2);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -half; dy <= half; dy += 1) {
          for (let dx = -half; dx <= half; dx += 1) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              sum += gray[ny * width + nx];
              count += 1;
            }
          }
        }
        const localMean = sum / count;
        const idx = y * width + x;
        const sharp = Math.min(255, Math.max(0, gray[idx] + (gray[idx] - localMean) * 0.35));
        const binary = sharp > localMean - 10 ? 255 : 0;
        const offset = idx * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = binary;
        pixels[offset + 3] = 255;
      }
    }
  }

  function renderVariant(sourceCanvas, sx, sy, sw, sh, mode) {
    const width = Math.max(1, Math.round(sw));
    const height = Math.max(1, Math.round(sh));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    if (mode === "adaptive") {
      applyAdaptiveThreshold(imageData, width, height);
    } else {
      applyContrastEnhancement(imageData);
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function buildPreprocessVariantsFromCanvas(base, lotteryType) {
    const ssqStrips =
      lotteryType === "ssq"
        ? extractSsqRowStripsFromCanvas(base).map(function (strip) {
            return {
              id: strip.id,
              dataUrl: strip.dataUrl,
              dataUrls: strip.dataUrls || [strip.dataUrl],
              source: strip.source || "layout",
            };
          })
        : [];

    if (lotteryType === "ssq") {
      const zone = cropSsqNumberZone(base);
      const zone2x = scaleCanvas(zone, 2);
      const variants = [
        {
          id: "ssq-zone-contrast",
          dataUrl: canvasToDataUrl(
            renderVariant(zone2x, 0, 0, zone2x.width, zone2x.height, "contrast")
          ),
        },
      ];
      return {
        previewUrl: canvasToDataUrl(base),
        variants: variants,
        ssqStrips: ssqStrips,
      };
    }

    const width = base.width;
    const height = base.height;

    const lowerY = Math.round(height * 0.26);
    const lowerH = height - lowerY;
    const midY = Math.round(height * 0.18);
    const midH = Math.round(height * 0.72);

    const specs = [
      { id: "full-contrast", sx: 0, sy: 0, sw: width, sh: height, mode: "contrast" },
      { id: "full-adaptive", sx: 0, sy: 0, sw: width, sh: height, mode: "adaptive" },
      { id: "lower-contrast", sx: 0, sy: lowerY, sw: width, sh: lowerH, mode: "contrast" },
      { id: "lower-adaptive", sx: 0, sy: lowerY, sw: width, sh: lowerH, mode: "adaptive" },
      { id: "mid-contrast", sx: 0, sy: midY, sw: width, sh: midH, mode: "contrast" },
    ];

    const variants = specs.map(function (spec) {
      const canvas = renderVariant(base, spec.sx, spec.sy, spec.sw, spec.sh, spec.mode);
      return { id: spec.id, dataUrl: canvasToDataUrl(canvas) };
    });

    return {
      previewUrl: canvasToDataUrl(base),
      variants: variants,
      ssqStrips: [],
    };
  }

  const SSQ_STRIP_HIT_RATE = 0.4;

  function shouldSkipSupplementalZoneOcr(linesByIndex) {
    if (!linesByIndex || !linesByIndex.length) return false;
    return linesByIndex.every(function (line) {
      return !!line;
    });
  }

  function buildFinalSsqLines(stripResult, ocrResult, expectedCount) {
    expectedCount = expectedCount || 5;
    const byIndex = stripResult.linesByIndex || [];
    const used = new Set();
    const output = [];

    for (let i = 0; i < byIndex.length; i += 1) {
      const line = byIndex[i] || null;
      output.push(line);
      if (line) used.add(line);
    }

    const zoneLines = (ocrResult.lines || []).filter(function (line) {
      return line && !used.has(line);
    });
    let zoneIdx = 0;

    for (let i = 0; i < output.length; i += 1) {
      if (!output[i] && zoneIdx < zoneLines.length) {
        output[i] = zoneLines[zoneIdx];
        used.add(output[i]);
        zoneIdx += 1;
      }
    }

    while (output.length < expectedCount && zoneIdx < zoneLines.length) {
      const line = zoneLines[zoneIdx];
      zoneIdx += 1;
      if (!used.has(line)) {
        output.push(line);
        used.add(line);
      }
    }

    return output.filter(Boolean).slice(0, expectedCount);
  }

  function collectParsedLineVotes(texts, lotteryType) {
    const votes = {};
    const firstSeen = {};

    texts.forEach(function (text, textIndex) {
      if (!text || !String(text).trim()) return;
      parseTextToLines(text, lotteryType).forEach(function (line, lineIndex) {
        votes[line] = (votes[line] || 0) + 1;
        const position = textIndex * 10000 + lineIndex;
        if (firstSeen[line] == null || position < firstSeen[line]) {
          firstSeen[line] = position;
        }
      });
    });

    const lines = Object.keys(firstSeen);
    if (!lines.length) return { lines: [], votes: votes };

    lines.sort(function (a, b) {
      return firstSeen[a] - firstSeen[b];
    });

    if (lotteryType === "ssq" && lines.length > 5) {
      const top = lines
        .slice()
        .sort(function (a, b) {
          const voteDiff = (votes[b] || 0) - (votes[a] || 0);
          if (voteDiff !== 0) return voteDiff;
          return firstSeen[a] - firstSeen[b];
        })
        .slice(0, 5)
        .sort(function (a, b) {
          return firstSeen[a] - firstSeen[b];
        });
      return { lines: top, votes: votes };
    }

    return { lines: lines, votes: votes };
  }

  function mergeParsedLines(texts, lotteryType) {
    return collectParsedLineVotes(texts, lotteryType).lines;
  }

  function makeProgressReporter(onProgress) {
    return function report(percent, message) {
      if (!onProgress) return;
      onProgress(message, Math.max(0, Math.min(100, Math.round(percent))));
    };
  }

  async function runMultiPassOcr(variants, onPass) {
    const texts = [];
    for (let v = 0; v < variants.length; v += 1) {
      const result = await recognizeDataUrl(variants[v].dataUrl);
      texts.push(result.text || "");
      if (onPass) onPass(v + 1, variants.length);
      await yieldToMain();
    }
    return texts;
  }

  async function runSsqStripOcr(strips, onPass) {
    if (!strips.length) {
      return { lines: [], linesByIndex: [], votes: {} };
    }

    const votes = {};
    const linesByIndex = [];

    for (let i = 0; i < strips.length; i += 1) {
      const line = await recognizeSsqStripBest(strips[i]);
      linesByIndex.push(line || null);
      if (line) {
        const weight = strips[i].source === "layout" ? 4 : 3;
        votes[line] = (votes[line] || 0) + weight;
      }
      if (onPass) onPass(i + 1, strips.length);
      await yieldToMain();
    }

    const lines = linesByIndex.filter(Boolean);

    return { lines: lines, linesByIndex: linesByIndex, votes: votes };
  }

  function ocrItemCenter(item) {
    const poly = item.poly || [];
    if (!poly.length) return { x: 0, y: 0 };
    let sx = 0;
    let sy = 0;
    poly.forEach(function (p) {
      sx += p.x;
      sy += p.y;
    });
    return { x: sx / poly.length, y: sy / poly.length };
  }

  function ocrItemHeight(item) {
    const poly = item.poly || [];
    if (!poly.length) return 14;
    let minY = poly[0].y;
    let maxY = poly[0].y;
    poly.forEach(function (p) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    return maxY - minY;
  }

  function groupOcrItemsByRow(items) {
    if (!items || !items.length) return [];

    const sorted = items.slice().sort(function (a, b) {
      return ocrItemCenter(a).y - ocrItemCenter(b).y;
    });
    const rows = [];

    sorted.forEach(function (item) {
      const center = ocrItemCenter(item);
      const threshold = Math.max(10, ocrItemHeight(item) * 0.55);
      let row = null;

      for (let i = 0; i < rows.length; i += 1) {
        if (Math.abs(rows[i].cy - center.y) < threshold) {
          row = rows[i];
          break;
        }
      }

      if (!row) {
        row = { cy: center.y, items: [] };
        rows.push(row);
      } else {
        row.cy =
          (row.cy * row.items.length + center.y) / (row.items.length + 1);
      }
      row.items.push(item);
    });

    rows.sort(function (a, b) {
      return a.cy - b.cy;
    });

    return rows.map(function (row) {
      row.items.sort(function (a, b) {
        return ocrItemCenter(a).x - ocrItemCenter(b).x;
      });
      return row.items
        .map(function (item) {
          return item.text || "";
        })
        .join(" ");
    });
  }

  function parseSsqFromOcrResult(result) {
    const texts = [];
    if (result && result.text) texts.push(result.text);

    if (result && result.items && result.items.length) {
      groupOcrItemsByRow(result.items).forEach(function (rowText) {
        if (!rowText.trim()) return;
        texts.push(rowText);
        const line = parseSsqStripText(rowText);
        if (line) texts.push(line);
      });

      const fromItems = parseSsqStripFromItems(result.items);
      if (fromItems) texts.push(fromItems);

      texts.push(
        result.items
          .slice()
          .sort(function (a, b) {
            const ac = ocrItemCenter(a);
            const bc = ocrItemCenter(b);
            if (Math.abs(ac.y - bc.y) > 10) return ac.y - bc.y;
            return ac.x - bc.x;
          })
          .map(function (item) {
            return item.text || "";
          })
          .join("\n")
      );
    }

    const parsed = collectParsedLineVotes(texts, "ssq");
    if (parsed.lines.length >= 3) return parsed;

    const streamLines = parseSsqLines((result && result.text) || "");
    if (streamLines.length > parsed.lines.length) {
      return { lines: streamLines.slice(0, 5), votes: parsed.votes };
    }
    return parsed;
  }

  async function recognizeLotteryImage(file, lotteryType, onProgress) {
    if (!file) throw new Error("请先选择或拍摄照片");
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");

    const report = makeProgressReporter(onProgress);
    let prepared = null;
    try {
    report(2, "准备识别...");
    prepared = await preprocessImage(file, report, lotteryType);

    report(36, "正在加载 PaddleOCR...");
    global.__ocrLastProgressAt = Date.now();
    global.__ocrLastProgressMsg = "正在加载 PaddleOCR...";
    await loadOcrEngine(report);

    if (prepared.edgeLite) {
      let stripResult = { lines: [], linesByIndex: [], votes: {} };
      let stripRawText = "";

      if (lotteryType === "ssq" && prepared.ssqStrips.length) {
        report(40, "Edge 模式：逐行识别...");
        global.__ocrLastProgressAt = Date.now();
        global.__ocrLastProgressMsg = "Edge 逐行识别";
        stripResult = await runSsqStripOcr(prepared.ssqStrips, function (done, total) {
          const percent = 40 + Math.round((done / total) * 44);
          report(percent, "逐行识别 " + done + "/" + total);
          global.__ocrLastProgressAt = Date.now();
        });
        stripRawText = stripResult.lines.join("\n");
      }

      let lines = stripResult.linesByIndex.filter(Boolean);
      if (lotteryType === "ssq" && lines.length < 4 && prepared.variants.length) {
        report(86, "Edge 模式：补充整区识别...");
        global.__ocrLastProgressAt = Date.now();
        const zoneResult = await recognizeDataUrl(prepared.variants[0].dataUrl);
        const zoneParsed = parseSsqFromOcrResult(zoneResult);
        lines = buildFinalSsqLines(stripResult, zoneParsed, 5);
        stripRawText = [stripRawText, zoneResult.text || ""].filter(Boolean).join("\n");
      }

      await resetOcrEngine();
      await yieldToMain();
      report(92, "正在整理识别结果...");
      const previewUrl = prepared.previewUrl;
      report(100, "识别完成");
      return {
        rawText: stripRawText.trim(),
        lines: lines,
        detectedType: detectLotteryType(stripRawText),
        activeType: lotteryType,
        previewUrl: previewUrl,
      };
    }

    let stripResult = { lines: [], linesByIndex: [], votes: {} };
    let stripRawText = "";
    if (lotteryType === "ssq" && prepared.ssqStrips && prepared.ssqStrips.length) {
      report(40, "正在按票面排版识别号码...");
      stripResult = await runSsqStripOcr(prepared.ssqStrips, function (done, total) {
        const percent = 40 + Math.round((done / total) * 48);
        report(percent, "正在识别号码行 " + done + "/" + total);
      });
      stripRawText = stripResult.lines.join("\n");
    }

    const ssqFastDone =
      lotteryType === "ssq" &&
      shouldSkipSupplementalZoneOcr(stripResult.linesByIndex);

    let ocrTexts = [];
    if (!ssqFastDone) {
      const ocrStart = lotteryType === "ssq" && prepared.ssqStrips.length ? 88 : 40;
      report(ocrStart, lotteryType === "ssq" ? "正在补充识别..." : "正在识别号码...");
      ocrTexts = await runMultiPassOcr(prepared.variants, function (done, total) {
        const percent = ocrStart + (done / total) * (92 - ocrStart);
        report(percent, "增强识别中 " + done + "/" + total);
      });
    } else {
      report(92, "逐行识别完成...");
    }

    report(94, "正在整理识别结果...");

    const rawText = [stripRawText]
      .concat(
        ocrTexts.map(function (text) {
          return String(text || "").trim();
        })
      )
      .filter(Boolean)
      .join("\n---\n");

    const detectedType = detectLotteryType(rawText);
    const activeType = detectedType || lotteryType;
    const ocrResult = collectParsedLineVotes(ocrTexts, activeType);
    let lines =
      lotteryType === "ssq"
        ? buildFinalSsqLines(
            stripResult,
            ocrResult,
            Math.max(prepared.ssqStrips.length || 0, 5)
          )
        : ocrResult.lines;
    const previewUrl = prepared.previewUrl;
    report(100, "识别完成");

    return {
      rawText: rawText.trim(),
      lines: lines,
      detectedType: detectedType,
      activeType: activeType,
      previewUrl: previewUrl,
    };
    } finally {
      releasePreparedImages(prepared);
    }
  }

  global.LotteryOcr = {
    recognizeLotteryImage: recognizeLotteryImage,
    parseTextToLines: parseTextToLines,
    detectLotteryType: detectLotteryType,
    resetEngine: resetOcrEngine,
  };
})(window);
