(function (global) {
  "use strict";

  let tesseractPromise = null;

  function loadTesseract() {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);
    if (tesseractPromise) return tesseractPromise;
    tesseractPromise = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload = function () {
        resolve(global.Tesseract);
      };
      script.onerror = function () {
        reject(new Error("OCR 引擎加载失败，请检查网络"));
      };
      document.head.appendChild(script);
    });
    return tesseractPromise;
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
    if (reds) return reds.join(" ") + " + " + blue;

    if (/^[1-5]\d{2}$/.test(String(tokens[0] || "").replace(/\D/g, ""))) {
      const tail = tokens.slice(1);
      const nums = [];
      tail.forEach(function (token) {
        const balls = ballsFromToken(token);
        if (balls.length === 1) nums.push(balls[0]);
      });
      if (nums.length === 5 && nums[0] === "04") {
        const recovered = ["03"].concat(nums);
        if (isValidSsqReds(recovered)) {
          return recovered.join(" ") + " + " + blue;
        }
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
          if (isValidSsqReds(red6)) {
            return red6.join(" ") + " + " + blues[0];
          }
        }
      }
    }

    const nums = extractNumbers(cleaned);
    for (let start = 0; start <= nums.length - 7; start += 1) {
      const reds = nums.slice(start, start + 6);
      const blue = nums[start + 6];
      if (isValidSsqReds(reds) && inRange(blue, 1, 16)) {
        return reds.join(" ") + " + " + blue;
      }
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
      if (isValidSsqReds(reds) && inRange(blue, 1, 16)) {
        lines.push(reds.join(" ") + " + " + blue);
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

        if (!isValidSsqReds(reds)) continue;
        return {
          line: reds.join(" ") + " + " + blue,
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

  const OPENCV_LOAD_TIMEOUT_MS = 6000;
  const OPENCV_SCRIPT =
    "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.1/dist/opencv.js";
  let openCvPromise = null;

  function loadOpenCV() {
    if (global.cv && global.cv.imread) return Promise.resolve(global.cv);
    if (openCvPromise) return openCvPromise;

    openCvPromise = new Promise(function (resolve, reject) {
      let settled = false;

      function finishOk() {
        if (settled) return;
        if (!global.cv || !global.cv.imread) return;
        settled = true;
        clearTimeout(timeout);
        resolve(global.cv);
      }

      function finishErr(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        openCvPromise = null;
        reject(err);
      }

      const timeout = setTimeout(function () {
        finishErr(new Error("OpenCV 加载超时"));
      }, OPENCV_LOAD_TIMEOUT_MS);

      const previousModule = global.Module || {};
      global.Module = Object.assign({}, previousModule, {
        onRuntimeInitialized: function () {
          finishOk();
        },
      });

      const script = document.createElement("script");
      script.src = OPENCV_SCRIPT;
      script.async = true;
      script.onload = function () {
        finishOk();
        if (settled) return;
        let tries = 0;
        const poll = setInterval(function () {
          tries += 1;
          finishOk();
          if (settled || tries >= 30) clearInterval(poll);
        }, 200);
      };
      script.onerror = function () {
        finishErr(new Error("OpenCV 加载失败"));
      };
      document.head.appendChild(script);
    });

    return openCvPromise;
  }

  function createScaledCanvas(img) {
    const maxWidth = 1800;
    const scale = Math.min(1, maxWidth / img.width);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
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

  async function prepareTicketCanvas(img, report) {
    let base = createScaledCanvas(img);
    report(10, "正在校正拍摄角度...");
    base = deskewCanvas(base);

    try {
      report(16, "正在尝试透视校正...");
      const cv = await loadOpenCV();
      report(24, "正在拉平票面...");
      const warped = tryPerspectiveCorrect(base, cv);
      if (warped) base = warped;
      report(32, "透视校正完成");
    } catch (_) {
      report(32, "透视校正跳过，继续识别...");
    }

    return base;
  }

  function preprocessImage(file, report) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("读取图片失败"));
      };
      reader.onload = function () {
        report(4, "正在读取图片...");
        const img = new Image();
        img.onload = function () {
          report(6, "正在预处理图片...");
          prepareTicketCanvas(img, report)
            .then(function (base) {
              report(34, "预处理完成");
              resolve(buildPreprocessVariantsFromCanvas(base));
            })
            .catch(reject);
        };
        img.onerror = function () {
          reject(new Error("图片格式不支持"));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function canvasToDataUrl(canvas) {
    return canvas.toDataURL("image/jpeg", 0.92);
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

  function buildPreprocessVariantsFromCanvas(base) {
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
    };
  }

  const OCR_PSM_MODES = ["6", "11", "13"];

  function mergeParsedLines(texts, lotteryType) {
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
    if (!lines.length) return [];

    lines.sort(function (a, b) {
      return firstSeen[a] - firstSeen[b];
    });

    if (lotteryType === "ssq" && lines.length > 5) {
      return lines
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
    }

    return lines;
  }

  function makeProgressReporter(onProgress) {
    return function report(percent, message) {
      if (!onProgress) return;
      onProgress(message, Math.max(0, Math.min(100, Math.round(percent))));
    };
  }

  async function runMultiPassOcr(Tesseract, variants, onPass) {
    const worker = await Tesseract.createWorker("eng");
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789 +|.,:选 ",
    });

    const texts = [];
    const total = variants.length * OCR_PSM_MODES.length;
    let done = 0;

    for (let v = 0; v < variants.length; v += 1) {
      for (let p = 0; p < OCR_PSM_MODES.length; p += 1) {
        await worker.setParameters({
          tessedit_pageseg_mode: OCR_PSM_MODES[p],
        });
        const result = await worker.recognize(variants[v].dataUrl);
        texts.push(result.data.text || "");
        done += 1;
        if (onPass) onPass(done, total);
      }
    }

    await worker.terminate();
    return texts;
  }

  async function recognizeLotteryImage(file, lotteryType, onProgress) {
    if (!file) throw new Error("请先选择或拍摄照片");
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");

    const report = makeProgressReporter(onProgress);
    report(2, "准备识别...");
    const prepared = await preprocessImage(file, report);

    report(36, "正在加载 OCR 引擎...");
    const Tesseract = await loadTesseract();

    report(40, "正在识别号码...");
    const ocrTexts = await runMultiPassOcr(Tesseract, prepared.variants, function (done, total) {
      const percent = 40 + (done / total) * 52;
      report(percent, "增强识别中 " + done + "/" + total);
    });

    report(94, "正在整理识别结果...");

    const rawText = ocrTexts
      .map(function (text) {
        return String(text || "").trim();
      })
      .filter(Boolean)
      .join("\n---\n");

    const detectedType = detectLotteryType(rawText);
    const activeType = detectedType || lotteryType;
    const lines = mergeParsedLines(ocrTexts, activeType);

    return {
      rawText: rawText.trim(),
      lines: lines,
      detectedType: detectedType,
      activeType: activeType,
      previewUrl: prepared.previewUrl,
    };
  }

  global.LotteryOcr = {
    recognizeLotteryImage: recognizeLotteryImage,
    parseTextToLines: parseTextToLines,
    detectLotteryType: detectLotteryType,
  };
})(window);
