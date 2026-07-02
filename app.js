const APP_VERSION = "1.8.6";
window.__appVersion = APP_VERSION;

const OCR_TOTAL_TIMEOUT_MS_MOBILE = 90000;
const OCR_TOTAL_TIMEOUT_MS_DESKTOP = 120000;
const OCR_CLOUD_TIMEOUT_MS = 240000;
const OCR_CLOUD_STALL_MS = 120000;

const HUINIAO_API = "https://api.huiniao.top/interface/home/lotteryHistory";
const CWL_API = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice";
const CWL_NAME_MAP = { ssq: "ssq", fcsd: "3d", qlc: "qlc", klb: "kl8" };
const SSQ_FUYUN_ISSUE_START = 2026014;
const SSQ_FUYUN_POOL_STOP = 300000000;
const SSQ_FUYUN_LEVEL = 7;
const FETCH_TIMEOUT_MS = 15000;
const FETCH_RETRY_COUNT = 3;
const ISSUE_PREVIOUS_COUNT = 3;

const LOTTERY = {
  ssq: {
    name: "双色球",
    hint: "每行一注：6个红球(01-33) + 1个蓝球(01-16)。例：01 05 12 18 25 33 + 08。奖池≥15亿时，中3个红球（不含蓝）可中福运奖5元。",
    parse(line) {
      const cleaned = line.replace(/[|+]/g, " ").replace(/[,，]/g, " ").trim();
      const parts = cleaned.split(/\s+/).filter(Boolean);
      if (parts.length < 7) throw new Error("双色球需要 6 个红球 + 1 个蓝球");
      const blue = parts.pop();
      const red = parts.slice(0, 6).map(normalize2);
      if (red.length !== 6) throw new Error("红球必须是 6 个");
      return { red, blue: normalize2(blue) };
    },
    normalizeDraw(raw) {
      if (raw.red && raw.blue) {
        return withPrizeMeta(raw, {
          issue: raw.code,
          date: raw.date,
          red: raw.red.split(",").map(normalize2),
          blue: normalize2(raw.blue),
        });
      }
      return withPrizeMeta(raw, {
        issue: raw.code,
        date: raw.day,
        red: [raw.one, raw.two, raw.three, raw.four, raw.five, raw.six].map(normalize2),
        blue: normalize2(raw.seven),
      });
    },
    check(ticket, draw) {
      const matched = matchNumberSets(ticket.red, draw.red);
      const redHit = matched.count;
      const blueHit = ticket.blue === draw.blue;
      let level = 0;
      let name = "未中奖";
      if (redHit === 6 && blueHit) {
        level = 1;
        name = "一等奖";
      } else if (redHit === 6) {
        level = 2;
        name = "二等奖";
      } else if (redHit === 5 && blueHit) {
        level = 3;
        name = "三等奖";
      } else if (redHit === 5 || (redHit === 4 && blueHit)) {
        level = 4;
        name = "四等奖";
      } else if (redHit === 4 || (redHit === 3 && blueHit)) {
        level = 5;
        name = "五等奖";
      } else if (blueHit && redHit <= 2) {
        level = 6;
        name = "六等奖";
      } else if (redHit === 3 && !blueHit) {
        const fuyunStatus = getSsqFuyunStatus(draw);
        if (fuyunStatus === "active") {
          level = SSQ_FUYUN_LEVEL;
          name = "福运奖";
        } else if (fuyunStatus === "unknown") {
          name = "福运奖待确认";
        }
      }
      const fuyunStatusForTicket =
        redHit === 3 && !blueHit ? getSsqFuyunStatus(draw) : "none";
      return {
        level,
        name,
        detail: `红球中 ${redHit} 个，蓝球${blueHit ? "中" : "未中"}`,
        hits: { red: matched.drawHits, blue: blueHit ? [ticket.blue] : [] },
        fuyunUnknown: fuyunStatusForTicket === "unknown",
      };
    },
    renderDraw(draw) {
      return renderBallRow(draw.red, "red", draw._hits?.red) +
        '<span class="plus">+</span>' +
        renderBallRow([draw.blue], "blue", draw._hits?.blue);
    },
    renderTicket(ticket, hits) {
      return (
        renderBallRow(ticket.red, "red", hits?.red) +
        '<span class="plus">+</span>' +
        renderBallRow([ticket.blue], "blue", hits?.blue)
      );
    },
  },
  fcsd: {
    name: "福彩3D",
    hint: "每行一注 3 位数字，如 130 或 1 3 0。完全一致的直选号码才算中奖。",
    parse(line) {
      const digits = line.replace(/[^\d]/g, "");
      if (digits.length !== 3) throw new Error("福彩3D 需要 3 位数字");
      return { digits: digits.split("") };
    },
    normalizeDraw(raw) {
      if (raw.red) {
        return withPrizeMeta(raw, {
          issue: raw.code,
          date: raw.date,
          digits: raw.red.split(",").map((n) => String(n)),
        });
      }
      return withPrizeMeta(raw, {
        issue: raw.code,
        date: raw.day,
        digits: [String(raw.one), String(raw.two), String(raw.three)],
      });
    },
    check(ticket, draw) {
      const hit = ticket.digits.every((d, i) => d === draw.digits[i]);
      return {
        level: hit ? 1 : 0,
        name: hit ? "直选中奖" : "未中奖",
        detail: hit ? "三位数字完全一致" : `开奖 ${draw.digits.join("")}，你的 ${ticket.digits.join("")}`,
        hits: { digits: hit ? ticket.digits : ticket.digits.filter((d, i) => d === draw.digits[i]) },
      };
    },
    renderDraw(draw) {
      return renderBallRow(draw.digits, "gold", draw._hits?.digits);
    },
    renderTicket(ticket, hits) {
      return renderBallRow(ticket.digits, "gold", hits?.digits);
    },
  },
  qlc: {
    name: "七乐彩",
    hint: "每行一注：7 个基本号 + 1 个特别号。例：03 08 12 15 22 27 30 + 18",
    parse(line) {
      const cleaned = line.replace(/[|+]/g, " ").replace(/[,，]/g, " ").trim();
      const parts = cleaned.split(/\s+/).filter(Boolean);
      if (parts.length < 8) throw new Error("七乐彩需要 7 个基本号 + 1 个特别号");
      const special = parts.pop();
      const basic = parts.slice(0, 7).map(normalize2);
      return { basic, special: normalize2(special) };
    },
    normalizeDraw(raw) {
      if (raw.red && raw.blue) {
        const basic = raw.red.split(",").map(normalize2);
        return withPrizeMeta(raw, {
          issue: raw.code,
          date: raw.date,
          basic: basic,
          special: normalize2(raw.blue),
        });
      }
      return withPrizeMeta(raw, {
        issue: raw.code,
        date: raw.day,
        basic: [raw.one, raw.two, raw.three, raw.four, raw.five, raw.six, raw.seven].map(normalize2),
        special: normalize2(raw.eight),
      });
    },
    check(ticket, draw) {
      const matched = matchNumberSets(ticket.basic, draw.basic);
      const basicHit = matched.count;
      const specialHit = ticket.special === draw.special;
      let level = 0;
      let name = "未中奖";
      if (basicHit === 7) {
        level = 1;
        name = "一等奖";
      } else if (basicHit === 6 && specialHit) {
        level = 2;
        name = "二等奖";
      } else if (basicHit === 6) {
        level = 3;
        name = "三等奖";
      } else if (basicHit === 5 && specialHit) {
        level = 4;
        name = "四等奖";
      } else if (basicHit === 5) {
        level = 5;
        name = "五等奖";
      } else if (basicHit === 4 && specialHit) {
        level = 6;
        name = "六等奖";
      } else if (basicHit === 4) {
        level = 7;
        name = "七等奖";
      }
      return {
        level,
        name,
        detail: `基本号中 ${basicHit} 个，特别号${specialHit ? "中" : "未中"}`,
        hits: {
          basic: matched.drawHits,
          special: specialHit ? [ticket.special] : [],
        },
      };
    },
    renderDraw(draw) {
      return renderBallRow(draw.basic, "gold", draw._hits?.basic) +
        '<span class="plus">+</span>' +
        renderBallRow([draw.special], "blue", draw._hits?.special);
    },
    renderTicket(ticket, hits) {
      return (
        renderBallRow(ticket.basic, "gold", hits?.basic) +
        '<span class="plus">+</span>' +
        renderBallRow([ticket.special], "blue", hits?.special)
      );
    },
  },
  klb: {
    name: "快乐8",
    hint: "每行一注，建议写「选5: 03 11 22 35 68」。不写选几则按你填的号码个数判断。",
    parse(line) {
      let playSize = null;
      let body = line.trim();
      const playMatch = body.match(/^选\s*(\d+)\s*[:：]\s*(.+)$/i);
      if (playMatch) {
        playSize = Number(playMatch[1]);
        body = playMatch[2];
      }
      const nums = body.replace(/[,，]/g, " ").split(/\s+/).filter(Boolean).map(normalize2);
      if (nums.length < 1 || nums.length > 10) throw new Error("快乐8 每注 1-10 个号码");
      if (playSize == null) playSize = nums.length;
      return { playSize, nums };
    },
    normalizeDraw(raw) {
      const keys = [
        "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
        "eighteen", "nineteen", "twenty",
      ];
      const nums = keys.map((k) => normalize2(raw[k]));
      return withPrizeMeta(raw, { issue: raw.code, date: raw.day, nums: nums });
    },
    check(ticket, draw) {
      const matched = matchNumberSets(ticket.nums, draw.nums);
      const hitCount = matched.count;
      const amount = KL8_PRIZE_MONEY[ticket.playSize]?.[hitCount];
      const won = amount != null;
      const label =
        KL8_PRIZE_HINT[ticket.playSize]?.[hitCount] ||
        (won ? "选" + ticket.playSize + "中" + hitCount : "未中奖");
      return {
        level: won ? 1 : 0,
        name: won ? label : "未中奖",
        detail: "选" + ticket.playSize + "，命中 " + hitCount + " 个",
        playSize: ticket.playSize,
        hitCount: hitCount,
        hits: { nums: matched.drawHits },
      };
    },
    renderDraw(draw) {
      return renderBallRow(draw.nums, "gold", draw._hits?.nums);
    },
    renderTicket(ticket, hits) {
      return renderBallRow(ticket.nums, "gold", hits?.nums);
    },
  },
};

const KL8_PRIZE_MONEY = {
  10: { 10: 5000000, 9: 8000, 8: 720, 7: 80, 6: 5, 5: 3, 0: 2 },
  9: { 9: 300000, 8: 2000, 7: 225, 6: 22, 5: 5, 4: 3, 0: 2 },
  8: { 8: 50000, 7: 800, 6: 88, 5: 10, 4: 3, 0: 2 },
  7: { 7: 10000, 6: 288, 5: 28, 4: 4, 0: 2 },
  6: { 6: 3000, 5: 30, 4: 10, 3: 3 },
  5: { 5: 1000, 4: 21, 3: 3 },
  4: { 4: 100, 3: 5, 2: 3 },
  3: { 3: 53, 2: 3 },
  2: { 2: 19 },
  1: { 1: 4.6 },
};

const FIXED_PRIZES = {
  ssq: { 3: 3000, 4: 200, 5: 10, 6: 5, 7: 5 },
  qlc: { 3: 500, 4: 300, 5: 50, 6: 10, 7: 5 },
  fcsd: { 1: 1040 },
};

const FLOATING_LEVELS = {
  ssq: [1, 2],
  qlc: [1, 2],
};

const KL8_PRIZE_HINT = {
  10: {
    10: "选十中十",
    9: "选十中九",
    8: "选十中八",
    7: "选十中七",
    6: "选十中六",
    5: "选十中五",
    0: "选十中零（全不中也有奖）",
  },
  5: {
    5: "选五中五",
    4: "选五中四",
    3: "选五中三",
  },
  3: {
    3: "选三中三",
    2: "选三中二",
  },
};

const DRAW_SCHEDULE = {
  ssq: { weekdays: [0, 2, 4], hour: 21, minute: 15 },
  fcsd: { weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 21, minute: 15 },
  qlc: { weekdays: [1, 3, 5], hour: 21, minute: 15 },
  klb: { weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 21, minute: 30 },
};

const state = {
  type: "ssq",
  draws: [],
  currentDraw: null,
  nextDraw: null,
  source: "",
  ocrLines: [],
};

let nextDrawTimer = null;
let selectedIssue = "";

const els = {
  lotteryType: document.getElementById("lotteryType"),
  issueTabs: document.getElementById("issueTabs"),
  refreshBtn: document.getElementById("refreshBtn"),
  compareBtn: document.getElementById("compareBtn"),
  fetchStatus: document.getElementById("fetchStatus"),
  drawMeta: document.getElementById("drawMeta"),
  nextDrawMeta: document.getElementById("nextDrawMeta"),
  drawBalls: document.getElementById("drawBalls"),
  compareResults: document.getElementById("compareResults"),
  accessInfo: document.getElementById("accessInfo"),
  localAccess: document.getElementById("localAccess"),
  cameraInput: document.getElementById("cameraInput"),
  galleryInput: document.getElementById("galleryInput"),
  ocrPreviewWrap: document.getElementById("ocrPreviewWrap"),
  ocrPreview: document.getElementById("ocrPreview"),
  ocrProgressWrap: document.getElementById("ocrProgressWrap"),
  ocrProgressTrack: document.getElementById("ocrProgressTrack"),
  ocrProgressFill: document.getElementById("ocrProgressFill"),
  ocrProgressPct: document.getElementById("ocrProgressPct"),
  ocrStatus: document.getElementById("ocrStatus"),
  ocrRawWrap: document.getElementById("ocrRawWrap"),
  ocrRawText: document.getElementById("ocrRawText"),
  menuBtn: document.getElementById("menuBtn"),
  menuPanel: document.getElementById("menuPanel"),
  menuClose: document.getElementById("menuClose"),
  menuBackdrop: document.getElementById("menuBackdrop"),
  currentLotteryLabel: document.getElementById("currentLotteryLabel"),
  appVersion: document.getElementById("appVersion"),
  ocrErrorModal: document.getElementById("ocrErrorModal"),
  ocrErrorMessage: document.getElementById("ocrErrorMessage"),
  ocrErrorLog: document.getElementById("ocrErrorLog"),
  ocrErrorClose: document.getElementById("ocrErrorClose"),
  ocrErrorBackdrop: document.getElementById("ocrErrorBackdrop"),
  ocrStallBanner: document.getElementById("ocrStallBanner"),
  ocrStallBannerClose: document.getElementById("ocrStallBannerClose"),
};

let ocrLastStatus = "";
let ocrErrorShown = false;
let mainStallTimer = null;
let ocrBusy = false;
const OCR_WATCHDOG_MS_MOBILE = 60000;
const OCR_WATCHDOG_MS_DESKTOP = 90000;
const OCR_STALL_MS_MOBILE = 8000;
const OCR_STALL_MS_DESKTOP = 15000;
const OCR_STALL_MS_EDGE = 18000;

function normalize2(value) {
  const n = String(value).trim();
  return n.length === 1 ? "0" + n : n;
}

function matchNumberSets(ticketNums, drawNums) {
  const remaining = {};
  drawNums.forEach(function (n) {
    remaining[n] = (remaining[n] || 0) + 1;
  });
  const drawHits = [];
  let count = 0;
  ticketNums.forEach(function (n) {
    if (remaining[n] > 0) {
      count += 1;
      drawHits.push(n);
      remaining[n] -= 1;
    }
  });
  return { count: count, drawHits: drawHits };
}

function parsePrizeGrades(raw) {
  if (!raw) return null;
  const grades = {};
  if (Array.isArray(raw.prizegrades)) {
    raw.prizegrades.forEach(function (item) {
      const level = Number(item.type);
      const money = Number(item.typemoney);
      if (level && money) grades[level] = money;
    });
  }
  const fyjMoney = Number(raw.fyjMoney);
  if (fyjMoney > 0) grades[SSQ_FUYUN_LEVEL] = fyjMoney;
  return Object.keys(grades).length ? grades : null;
}

function parseDrawMoneyMeta(raw) {
  if (!raw) return {};
  const meta = {};
  if (raw.poolmoney != null && raw.poolmoney !== "") {
    meta.poolMoney = Number(raw.poolmoney);
  }
  if (raw.fyjCount != null && raw.fyjCount !== "") {
    meta.fyjCount = Number(raw.fyjCount);
  }
  if (raw.fyjMoney != null && raw.fyjMoney !== "") {
    meta.fyjMoney = Number(raw.fyjMoney);
  }
  return meta;
}

function parseIssueNumber(issue) {
  return parseInt(String(issue || ""), 10) || 0;
}

function getSsqFuyunStatus(draw) {
  if (!draw) return "none";
  if (parseIssueNumber(draw.issue) < SSQ_FUYUN_ISSUE_START) return "none";
  if (draw.fyjCount > 0 || draw.fyjMoney > 0) return "active";
  if (draw.poolMoney != null && !Number.isNaN(draw.poolMoney)) {
    return draw.poolMoney >= SSQ_FUYUN_POOL_STOP ? "active" : "inactive";
  }
  return "unknown";
}

function isSsqFuyunActive(draw) {
  return getSsqFuyunStatus(draw) === "active";
}

function formatMoney(amount, floating) {
  if (floating) return "浮动奖金（以官方公告为准）";
  if (amount == null || amount <= 0) return "0 元";
  if (amount >= 10000) {
    const wan = amount / 10000;
    return (Number.isInteger(wan) ? wan : wan.toFixed(2)) + " 万元";
  }
  return Number.isInteger(amount) ? amount.toLocaleString("zh-CN") + " 元" : amount + " 元";
}

function resolvePrizeAmount(type, result, draw) {
  if (result.level <= 0) {
    return { amount: 0, text: "0 元", floating: false };
  }

  if (type === "klb") {
    const amount = KL8_PRIZE_MONEY[result.playSize]?.[result.hitCount];
    if (amount == null) {
      return { amount: 0, text: "未达中奖档", floating: false };
    }
    return { amount: amount, text: formatMoney(amount), floating: false };
  }

  const floating = (FLOATING_LEVELS[type] || []).includes(result.level);
  const fromDraw = draw.prizeGrades && draw.prizeGrades[result.level];
  if (fromDraw) {
    return { amount: fromDraw, text: formatMoney(fromDraw), floating: false };
  }
  if (floating) {
    return { amount: null, text: formatMoney(null, true), floating: true };
  }

  const fixed = FIXED_PRIZES[type]?.[result.level];
  return {
    amount: fixed || 0,
    text: fixed ? formatMoney(fixed) : "奖金未知",
    floating: false,
  };
}

function withPrizeMeta(raw, base) {
  const grades = parsePrizeGrades(raw);
  const moneyMeta = parseDrawMoneyMeta(raw);
  return Object.assign({}, base, moneyMeta, grades ? { prizeGrades: grades } : {});
}

function renderBallRow(nums, cls, hits = []) {
  const hitSet = new Set((hits || []).map(normalize2));
  return nums
    .map((n) => {
      const v = normalize2(n);
      const hitClass = hitSet.has(v) ? " hit" : "";
      return `<span class="ball ${cls}${hitClass}">${v}</span>`;
    })
    .join("");
}

function updateOcrProgress(percent) {
  if (!els.ocrProgressWrap) return;
  if (percent == null || percent < 0) {
    els.ocrProgressWrap.classList.add("hidden");
    els.ocrProgressWrap.setAttribute("aria-hidden", "true");
    return;
  }

  const value = Math.max(0, Math.min(100, Math.round(percent)));
  els.ocrProgressWrap.classList.remove("hidden");
  els.ocrProgressWrap.setAttribute("aria-hidden", "false");
  if (els.ocrProgressFill) els.ocrProgressFill.style.width = value + "%";
  if (els.ocrProgressPct) els.ocrProgressPct.textContent = value + "%";
  if (els.ocrProgressTrack) els.ocrProgressTrack.setAttribute("aria-valuenow", String(value));
}

function setOcrStatus(text, isError = false, percent) {
  els.ocrStatus.textContent = text;
  els.ocrStatus.className = isError ? "status ocr-status-line error" : "status ocr-status-line";
  if (percent != null && percent >= 0) {
    updateOcrProgress(percent);
  } else {
    updateOcrProgress(null);
  }
}

function onOcrProgress(message, percent) {
  ocrLastStatus = message;
  window.__ocrLastProgressAt = Date.now();
  window.__ocrLastProgressMsg = message;
  pushOcrDiag((percent != null ? percent + "% " : "") + message);
  setOcrStatus(message, false, percent);
}

function pushOcrDiag(message) {
  const log = window.__lotteryOcrDiag || (window.__lotteryOcrDiag = []);
  const line = new Date().toISOString().slice(11, 19) + " " + message;
  log.push(line);
  if (log.length > 100) log.shift();
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || "");
}

function isEdgeBrowser() {
  return /EdgA|EdgiOS|Edg\//i.test(navigator.userAgent || "");
}

function getOcrStallMs() {
  if (window.LotteryOcr && window.LotteryOcr.prefersHelloLotteryApi()) {
    return OCR_CLOUD_STALL_MS;
  }
  if (isEdgeBrowser()) return OCR_STALL_MS_EDGE;
  return isMobileDevice() ? OCR_STALL_MS_MOBILE : OCR_STALL_MS_DESKTOP;
}

function getOcrWatchdogMs() {
  if (window.LotteryOcr && window.LotteryOcr.prefersHelloLotteryApi()) {
    return OCR_CLOUD_TIMEOUT_MS;
  }
  return isMobileDevice() ? OCR_WATCHDOG_MS_MOBILE : OCR_WATCHDOG_MS_DESKTOP;
}

async function disposeOcrEngineSafely() {
  try {
    if (window.LotteryOcr && window.LotteryOcr.resetEngine) {
      await window.LotteryOcr.resetEngine();
    }
  } catch (_) {
    /* ignore */
  }
}

function startOcrWatchdog() {
  stopOcrWatchdog();
  const ms = getOcrWatchdogMs();
  pushOcrDiag("watchdog start " + ms + "ms iframe");
  if (window.LotteryOcrWatchdog) {
    window.LotteryOcrWatchdog.start(ms, {
      version: APP_VERSION,
      lastStatus: ocrLastStatus,
      stallMs: getOcrStallMs(),
    });
  }
}

function stopMainStallMonitor() {
  if (mainStallTimer) {
    clearInterval(mainStallTimer);
    mainStallTimer = null;
  }
}

function startMainStallMonitor() {
  stopMainStallMonitor();
  const stallMs = getOcrStallMs();
  mainStallTimer = setInterval(function () {
    if (!window.__ocrScanActive || window.__ocrErrorShown) return;
    const stalled = Date.now() - (window.__ocrLastProgressAt || 0);
    if (stalled < stallMs) return;
    const msg =
      "识别卡住：" +
      (window.__ocrLastProgressMsg || "未知步骤") +
      "（已 " +
      Math.round(stalled / 1000) +
      " 秒）";
    const log = (window.__lotteryOcrDiag || []).join("\n");
    pushOcrDiag("main stall monitor fired");
    if (window.__showOcrFatal) {
      window.__showOcrFatal(msg, log);
    } else {
      showOcrErrorDialog(new Error(msg));
    }
  }, 1000);
}

function withOcrTimeout(promise) {
  const useCloud =
    window.LotteryOcr && window.LotteryOcr.prefersHelloLotteryApi();
  const ms = useCloud
    ? OCR_CLOUD_TIMEOUT_MS
    : isMobileDevice()
      ? OCR_TOTAL_TIMEOUT_MS_MOBILE
      : OCR_TOTAL_TIMEOUT_MS_DESKTOP;
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () {
        reject(
          new Error(
            "识别总超时（已等待 " + Math.round(ms / 1000) + " 秒，请刷新重试）"
          )
        );
      }, ms);
    }),
  ]);
}

function stopOcrWatchdog() {
  if (window.LotteryOcrWatchdog) {
    window.LotteryOcrWatchdog.stop();
  }
}

function closeOcrErrorDialog() {
  if (!els.ocrErrorModal) return;
  els.ocrErrorModal.classList.add("hidden");
  els.ocrErrorModal.setAttribute("aria-hidden", "true");
  if (els.ocrStallBanner) els.ocrStallBanner.classList.add("hidden");
  document.body.style.overflow = "";
}

function openOcrErrorFromBanner() {
  if (!window.__ocrErrorShown && ocrLastStatus) {
    showOcrErrorDialog(new Error("识别卡住（停在：" + ocrLastStatus + "）"));
    return;
  }
  if (els.ocrErrorModal) {
    els.ocrErrorModal.classList.remove("hidden");
    els.ocrErrorModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
}

function showOcrErrorDialog(err) {
  if (ocrErrorShown && window.__ocrErrorShown) return;
  ocrErrorShown = true;
  window.__ocrErrorShown = true;
  const msg = (err && err.message) || String(err || "识别失败");
  const snapshot = {
    version: APP_VERSION,
    lastStatus: ocrLastStatus,
    cvReady: !!(window.cv && window.cv.Mat),
    opencvScript: !!document.querySelector('script[data-lottery-opencv="1"]'),
    paddleEngine: !!(window.LotteryOcrEngine),
    ua: navigator.userAgent,
  };
  const logText = (window.__lotteryOcrDiag || [])
    .concat(["---", JSON.stringify(snapshot, null, 2)])
    .join("\n");

  setOcrStatus(msg, true);
  if (window.__showOcrFatal) {
    window.__showOcrFatal(msg, logText);
    return;
  }
  if (els.ocrErrorModal && els.ocrErrorMessage && els.ocrErrorLog) {
    els.ocrErrorMessage.textContent = msg;
    els.ocrErrorLog.textContent = logText;
    els.ocrErrorModal.classList.remove("hidden");
    els.ocrErrorModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    const boot = document.getElementById("bootOverlay");
    if (boot) boot.classList.add("hidden");
    return;
  }
  window.alert(msg + "\n\n" + logText.slice(-1800));
}

function preloadOcrAssets() {
  pushOcrDiag("preload: cloud-only, skip local paddle");
  if (window.LotteryOcrWatchdog) {
    window.LotteryOcrWatchdog.hideBootOverlay();
  }
  var boot = document.getElementById("bootOverlay");
  if (boot) {
    boot.classList.add("hidden");
    boot.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
}

function setStatus(text, isError = false) {
  els.fetchStatus.textContent = text;
  els.fetchStatus.className = isError ? "status-line error" : "status-line";
}

function syncLotteryTabs(type) {
  document.querySelectorAll(".lottery-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
  if (els.currentLotteryLabel) {
    els.currentLotteryLabel.textContent = LOTTERY[type].name;
  }
}

function openMenu() {
  els.menuPanel.classList.remove("hidden");
  els.menuPanel.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeMenu() {
  els.menuPanel.classList.add("hidden");
  els.menuPanel.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

async function loadAccessInfo() {
  const isLocal =
    location.hostname === "127.0.0.1" || location.hostname === "localhost";

  if (!isLocal) {
    els.localAccess.classList.add("hidden");
    return;
  }

  try {
    const resp = await fetch("/api/info");
    if (!resp.ok) throw new Error("no local server");
    const info = await resp.json();
    els.accessInfo.innerHTML =
      `<a class="access-link" href="http://127.0.0.1:${info.port}">` +
      `<span class="access-link-label">电脑浏览器</span>` +
      `<span class="access-link-url">127.0.0.1:${info.port}</span></a>` +
      `<a class="access-link" href="${info.url}">` +
      `<span class="access-link-label">手机同一 WiFi</span>` +
      `<span class="access-link-url">${info.ip}:${info.port}</span></a>`;
    els.localAccess.classList.remove("hidden");
  } catch (_) {
    els.localAccess.classList.add("hidden");
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

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function getHuiniaoWrap(payload) {
  const outer = payload && payload.data ? payload.data : payload || {};
  if (outer && outer.data && (outer.data.list || outer.data.data)) {
    return outer.data;
  }
  return outer;
}

function getHuiniaoDrawList(payload) {
  const wrap = getHuiniaoWrap(payload);
  return wrap.data?.list || wrap.list || [];
}

function getLatestRawDraw(huiniao) {
  const list = huiniao.data?.data?.list || huiniao.data?.list || [];
  if (list.length) return list[0];
  return huiniao.data?.last || huiniao.data?.data?.last || null;
}

function validateOnlineDraw(type, raw) {
  if (!raw || !raw.code) return false;
  const issue = String(raw.code).trim();
  if (!/^\d{5,8}$/.test(issue)) return false;

  switch (type) {
    case "ssq":
      if (raw.red && raw.blue) {
        return raw.red.split(",").filter(Boolean).length === 6;
      }
      return (
        raw.one &&
        raw.two &&
        raw.three &&
        raw.four &&
        raw.five &&
        raw.six &&
        raw.seven
      );
    case "fcsd":
      if (raw.red) return raw.red.split(",").filter(Boolean).length === 3;
      return raw.one && raw.two && raw.three;
    case "qlc":
      if (raw.red && raw.blue) {
        return raw.red.split(",").filter(Boolean).length === 7;
      }
      return raw.one && raw.eight;
    case "klb":
      return raw.one && raw.twenty;
    default:
      return false;
  }
}

function validateHuiniaoPayload(data, type) {
  if (!data || data.code !== 1) return false;
  return validateOnlineDraw(type, getLatestRawDraw(data));
}

function formatSourceLabel(source) {
  if (source === "cwl") return "中国福利彩票官网";
  if (source === "huiniao") return "在线开奖接口";
  if (source === "公开开奖接口" || source === "在线开奖接口") return source;
  return source || "在线开奖接口";
}

async function fetchHuiniaoOnline(type, limit, page) {
  page = page || 1;
  const url =
    HUINIAO_API +
    "?type=" +
    encodeURIComponent(type) +
    "&page=" +
    encodeURIComponent(page) +
    "&limit=" +
    encodeURIComponent(limit) +
    "&_=" +
    String(Date.now());

  let lastErr = null;
  for (let attempt = 1; attempt <= FETCH_RETRY_COUNT; attempt += 1) {
    try {
      const resp = await fetchWithTimeout(
        url,
        { cache: "no-store", headers: { Accept: "application/json" } },
        FETCH_TIMEOUT_MS
      );
      if (!resp.ok) {
        throw new Error("开奖接口 HTTP " + String(resp.status));
      }
      const data = await resp.json();
      if (!validateHuiniaoPayload(data, type)) {
        throw new Error(data.info || "在线开奖数据校验失败");
      }
      return {
        source: "在线开奖接口",
        data: data,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_RETRY_COUNT) {
        await sleep(FETCH_RETRY_DELAY_MS * attempt);
      }
    }
  }

  if (lastErr && lastErr.name === "AbortError") {
    throw new Error("在线获取超时，请检查网络后点刷新重试");
  }
  throw new Error(lastErr?.message || "在线获取开奖数据失败，请稍后重试");
}

async function fetchLotteryPayload(type, limit) {
  const isLocal =
    location.hostname === "127.0.0.1" || location.hostname === "localhost";

  if (isLocal) {
    const resp = await fetchWithTimeout(
      `/api/lottery?type=${encodeURIComponent(type)}&limit=${limit}&source=auto`,
      { cache: "no-store" },
      FETCH_TIMEOUT_MS
    );
    const payload = await resp.json();
    if (!resp.ok || payload.error) {
      throw new Error(payload.error || "请求失败");
    }
    return Object.assign({ fetchedAt: new Date().toISOString() }, payload);
  }

  return fetchHuiniaoOnline(type, limit);
}

function getWantedIssue() {
  return String(selectedIssue || "").trim();
}

function setIssueSelection(issue) {
  selectedIssue = String(issue || "").trim();
  renderIssueTabs(state.draws);
}

function buildIssueTabItems(draws) {
  const items = [{ issue: "", label: "最新一期" }];
  const list = draws || [];
  list.slice(1, 1 + ISSUE_PREVIOUS_COUNT).forEach(function (draw) {
    items.push({
      issue: String(draw.issue),
      label: "第 " + draw.issue + " 期",
    });
  });
  if (
    selectedIssue &&
    !items.some(function (item) {
      return item.issue === selectedIssue;
    })
  ) {
    items.push({
      issue: selectedIssue,
      label: "第 " + selectedIssue + " 期",
    });
  }
  return items;
}

function renderIssueTabs(draws) {
  if (!els.issueTabs) return;
  const items = buildIssueTabItems(draws);
  const activeIssue = getWantedIssue();
  els.issueTabs.innerHTML = items
    .map(function (item) {
      const isActive = activeIssue ? activeIssue === item.issue : item.issue === "";
      return (
        '<button type="button" class="issue-tab' +
        (isActive ? " active" : "") +
        '" data-issue="' +
        escapeHtml(item.issue) +
        '" role="tab" aria-selected="' +
        (isActive ? "true" : "false") +
        '">' +
        escapeHtml(item.label) +
        "</button>"
      );
    })
    .join("");
}

function mergeDrawIntoList(draw) {
  if (!draw) return;
  const issue = String(draw.issue);
  if (
    state.draws.some(function (item) {
      return String(item.issue) === issue;
    })
  ) {
    return;
  }
  state.draws.push(draw);
  state.draws.sort(function (a, b) {
    return parseInt(b.issue, 10) - parseInt(a.issue, 10);
  });
}

async function findDrawByIssueOnline(type, issue) {
  const wanted = String(issue || "").trim();
  if (!wanted) return null;

  const cached = state.draws.find(function (draw) {
    return String(draw.issue) === wanted;
  });
  if (cached) return cached;

  for (let page = 1; page <= 5; page += 1) {
    const payload = await fetchHuiniaoOnline(type, 30, page);
    const draws = parseDrawList(payload, type);
    const found = draws.find(function (draw) {
      return String(draw.issue) === wanted;
    });
    if (found) return found;
    if (draws.length < 30) break;
  }
  return null;
}

function applyCurrentDraw(draw) {
  if (!draw) return;
  state.currentDraw = draw;
  renderDraw(draw);
  const timeLabel = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  setStatus(
    "已切换：第 " +
      draw.issue +
      " 期 · " +
      formatSourceLabel(state.source) +
      " · " +
      timeLabel
  );
  if (state.ocrLines.length) {
    compareNumbers(state.ocrLines);
  }
}

async function applyIssueSelection() {
  const wantedIssue = getWantedIssue();
  if (!wantedIssue) {
    if (state.draws.length) {
      applyCurrentDraw(state.draws[0]);
      return;
    }
    await fetchDraws();
    return;
  }

  let draw = state.draws.find(function (item) {
    return String(item.issue) === wantedIssue;
  });
  if (!draw) {
    setStatus("正在查询第 " + wantedIssue + " 期...");
    draw = await findDrawByIssueOnline(state.type || els.lotteryType.value, wantedIssue);
    if (draw) {
      mergeDrawIntoList(draw);
      renderIssueTabs(state.draws);
      setIssueSelection(wantedIssue);
    }
  }

  if (!draw) {
    setStatus("未找到期号 " + wantedIssue, true);
    return;
  }

  applyCurrentDraw(draw);
}

function resetOcrSession() {
  state.ocrLines = [];
  updateOcrProgress(null);
  els.compareResults.innerHTML =
    '<div class="empty-state">拍照识别后，对照结果会显示在这里 ~</div>';
}

async function handleOcrFile(file) {
  if (!file) return;
  if (ocrBusy) {
    setOcrStatus("上一次识别尚未结束，请稍候...", true);
    return;
  }
  ocrBusy = true;
  resetOcrSession();
  window.__lotteryOcrDiag = [];
  ocrErrorShown = false;
  window.__ocrErrorShown = false;
  window.__ocrScanActive = true;
  window.__ocrLastProgressAt = Date.now();
  window.__ocrLastProgressMsg = "准备识别";
  window.__ocrStallMs = getOcrStallMs();
  pushOcrDiag("scan start " + file.name + " " + file.size + "b");
  if (window.LotteryOcr && window.LotteryOcr.prefersHelloLotteryApi()) {
    pushOcrDiag("ocr mode: hello-lottery cloud api");
  } else if (isEdgeBrowser()) {
    pushOcrDiag("edge low-memory mode");
  }
  setOcrStatus("准备云端识别（HelloLottery，免费；照片会上传至 Hugging Face）...", false, 0);
  els.ocrRawWrap.classList.add("hidden");
  startOcrWatchdog();
  startMainStallMonitor();

  try {
    const result = await withOcrTimeout(
      window.LotteryOcr.recognizeLotteryImage(
        file,
        els.lotteryType.value,
        onOcrProgress
      )
    );
    stopOcrWatchdog();
    stopMainStallMonitor();

    els.ocrPreview.src = result.previewUrl;
    els.ocrPreviewWrap.classList.remove("hidden");
    els.ocrRawText.textContent = result.rawText || "(空)";
    els.ocrRawWrap.classList.remove("hidden");

    if (result.detectedType && result.detectedType !== els.lotteryType.value) {
      els.lotteryType.value = result.detectedType;
      onTypeChange();
    }

    if (result.ocrSource === "hello-lottery-api") {
      pushOcrDiag("ocr source: hello-lottery cloud");
    }

    if (!result.lines.length) {
      setOcrStatus("识别完成，但未提取到有效号码。可查看原文或重新拍照。", false);
      return;
    }

    state.ocrLines = result.lines;
    setOcrStatus(`识别完成，共 ${result.lines.length} 注，正在对照...`);

    if (result.detectedIssue) {
      setIssueSelection(result.detectedIssue);
      pushOcrDiag("ticket issue: " + result.detectedIssue);
    }

    if (!state.currentDraw || result.detectedIssue) {
      await fetchDraws();
    }
    if (!state.currentDraw) {
      setOcrStatus("识别完成，但暂无开奖数据，请先刷新开奖后再拍照", true);
      return;
    }

    compareNumbers(state.ocrLines);
    setOcrStatus(`识别并对照完成，共 ${result.lines.length} 注`);
    els.compareResults.closest(".card-result")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  } catch (err) {
    stopOcrWatchdog();
    stopMainStallMonitor();
    showOcrErrorDialog(err);
  } finally {
    window.__ocrScanActive = false;
    stopMainStallMonitor();
    if (els.cameraInput) els.cameraInput.value = "";
    if (els.galleryInput) els.galleryInput.value = "";
    ocrBusy = false;
  }
}

function onOcrInputChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  handleOcrFile(file);
}

function bindScanInputs() {
  function onPickStart() {
    setOcrStatus("正在打开相册或相机...", false);
  }

  if (els.cameraInput) {
    els.cameraInput.addEventListener("click", onPickStart);
    els.cameraInput.addEventListener("change", onOcrInputChange);
  }
  if (els.galleryInput) {
    els.galleryInput.addEventListener("click", onPickStart);
    els.galleryInput.addEventListener("change", onOcrInputChange);
  }
}

function parseDrawList(payload, type) {
  const cfg = LOTTERY[type];
  if (payload.source === "cwl" || payload.source === "中国福利彩票官网") {
    return (payload.data.result || []).map(cfg.normalizeDraw);
  }
  const list = getHuiniaoDrawList(payload);
  if (list.length) return list.map(cfg.normalizeDraw);
  const wrap = getHuiniaoWrap(payload);
  const last = wrap.last;
  return last ? [cfg.normalizeDraw(last)] : [];
}

async function fetchDrawHistory(type, minCount) {
  minCount = minCount || ISSUE_PREVIOUS_COUNT + 1;
  const merged = [];
  const seen = new Set();
  let firstPayload = null;
  const isLocal =
    location.hostname === "127.0.0.1" || location.hostname === "localhost";

  if (isLocal) {
    const payload = await fetchLotteryPayload(type, Math.max(10, minCount));
    firstPayload = payload;
    parseDrawList(payload, type).forEach(function (draw) {
      const issue = String(draw.issue);
      if (seen.has(issue)) return;
      seen.add(issue);
      merged.push(draw);
    });
  } else {
    const payload = await fetchHuiniaoOnline(type, 5, 1);
    firstPayload = payload;
    parseDrawList(payload, type).forEach(function (draw) {
      const issue = String(draw.issue);
      if (seen.has(issue)) return;
      seen.add(issue);
      merged.push(draw);
    });

    for (let page = 2; page <= 3 && merged.length < minCount; page += 1) {
      const morePayload = await fetchHuiniaoOnline(type, 10, page);
      const draws = parseDrawList(morePayload, type);
      draws.forEach(function (draw) {
        const issue = String(draw.issue);
        if (seen.has(issue)) return;
        seen.add(issue);
        merged.push(draw);
      });
      if (draws.length < 10) break;
    }
  }

  merged.sort(function (a, b) {
    return parseInt(b.issue, 10) - parseInt(a.issue, 10);
  });

  return {
    draws: merged,
    payload: firstPayload,
  };
}

function parseNextDraw(payload, type) {
  const list = getHuiniaoDrawList(payload);
  const wrap = getHuiniaoWrap(payload);
  const raw = list[0] || wrap.last || payload.data?.last;
  if (!raw) return computeNextDrawFromSchedule(type);

  const issue = raw.next_code || raw.nextCode;
  const time = raw.next_open_time || raw.nextOpenTime;
  if (!time) return computeNextDrawFromSchedule(type);

  return {
    issue: issue ? String(issue) : "",
    time: String(time),
  };
}

function computeNextDrawFromSchedule(type, fromDate) {
  const cfg = DRAW_SCHEDULE[type];
  if (!cfg) return null;

  const now = fromDate || new Date();
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  for (let offset = 0; offset < 14; offset += 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + offset);
    if (!cfg.weekdays.includes(day.getDay())) continue;

    const target = new Date(day);
    target.setHours(cfg.hour, cfg.minute, 0, 0);
    if (target <= now) continue;

    const pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return {
      issue: "",
      time:
        target.getFullYear() +
        "-" +
        pad(target.getMonth() + 1) +
        "-" +
        pad(target.getDate()) +
        " " +
        pad(cfg.hour) +
        ":" +
        pad(cfg.minute) +
        ":00",
    };
  }
  return null;
}

function parseDrawDateTime(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/
  );
  if (!match) return value || "";
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (match[4] != null) return month + "月" + day + "日 " + match[4] + ":" + match[5];
  return month + "月" + day + "日";
}

function formatCountdown(timeStr) {
  const target = new Date(String(timeStr).replace(/-/g, "/"));
  if (Number.isNaN(target.getTime())) return "";

  const diff = target.getTime() - Date.now();
  if (diff <= 0) return "即将开奖";

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);

  if (days > 0) return "还有 " + days + " 天 " + hours + " 小时";
  if (hours > 0) return "还有 " + hours + " 小时 " + minutes + " 分钟";
  return "还有 " + minutes + " 分钟";
}

function renderNextDraw() {
  if (!state.nextDraw || !state.nextDraw.time) {
    els.nextDrawMeta.classList.add("hidden");
    els.nextDrawMeta.textContent = "";
    return;
  }

  const issueText = state.nextDraw.issue
    ? '第 <strong>' + escapeHtml(state.nextDraw.issue) + "</strong> 期"
    : "下一期";
  const timeText = parseDrawDateTime(state.nextDraw.time);
  const countdown = formatCountdown(state.nextDraw.time);

  els.nextDrawMeta.innerHTML =
    "<span>下次开奖 " +
    issueText +
    " · " +
    escapeHtml(timeText) +
    "</span>" +
    (countdown ? '<span class="next-countdown">' + escapeHtml(countdown) + "</span>" : "");
  els.nextDrawMeta.classList.remove("hidden");
}

function startNextDrawTimer() {
  if (nextDrawTimer) clearInterval(nextDrawTimer);
  nextDrawTimer = setInterval(renderNextDraw, 60000);
}

async function enrichDrawsWithCwlPrizes(type, draws) {
  if (type !== "ssq") return draws;

  try {
    let payload = null;
    const isLocal =
      location.hostname === "127.0.0.1" || location.hostname === "localhost";
    if (isLocal) {
      const resp = await fetch(
        `/api/lottery?type=${encodeURIComponent(type)}&limit=20&source=cwl`
      );
      payload = await resp.json();
      if (!resp.ok || payload.error) payload = null;
    } else {
      payload = await fetchCwlOnline(type, 20);
    }
    if (!payload) return draws;

    const cwlDraws = parseDrawList(payload, type);
    const cwlMap = {};
    cwlDraws.forEach(function (draw) {
      cwlMap[String(draw.issue)] = draw;
    });

    return draws.map(function (draw) {
      const cwl = cwlMap[String(draw.issue)];
      if (!cwl) return draw;
      return Object.assign({}, draw, {
        poolMoney: cwl.poolMoney != null ? cwl.poolMoney : draw.poolMoney,
        fyjCount: cwl.fyjCount != null ? cwl.fyjCount : draw.fyjCount,
        fyjMoney: cwl.fyjMoney != null ? cwl.fyjMoney : draw.fyjMoney,
        prizeGrades: Object.assign({}, draw.prizeGrades || {}, cwl.prizeGrades || {}),
      });
    });
  } catch (_) {
    return draws;
  }
}

async function fetchCwlOnline(type, limit) {
  const name = CWL_NAME_MAP[type];
  if (!name) return null;
  const url =
    CWL_API +
    "?" +
    new URLSearchParams({
      name: name,
      pageNo: "1",
      pageSize: String(Math.max(1, Math.min(limit, 30))),
      systemType: "PC",
    }).toString();
  const resp = await fetchWithTimeout(
    url,
    { cache: "no-store", headers: { Accept: "application/json" } },
    FETCH_TIMEOUT_MS
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (data.state !== 0) return null;
  return { source: "中国福利彩票官网", data: data };
}

async function fetchDraws() {
  const type = els.lotteryType.value;
  state.type = type;
  const wantedIssue = getWantedIssue();
  setStatus(
    wantedIssue
      ? "正在查询第 " + wantedIssue + " 期开奖..."
      : "正在在线获取开奖数据..."
  );
  els.refreshBtn.disabled = true;

  try {
    const history = await fetchDrawHistory(type, ISSUE_PREVIOUS_COUNT + 1);
    const payload = history.payload;

    state.draws = history.draws;
    state.draws = await enrichDrawsWithCwlPrizes(type, state.draws);
    state.nextDraw = payload ? parseNextDraw(payload, type) : computeNextDrawFromSchedule(type);
    state.source = payload ? payload.source : "在线开奖接口";
    if (state.draws.length < ISSUE_PREVIOUS_COUNT + 1) {
      pushOcrDiag(
        "issue history short: " + state.draws.length + "/" + (ISSUE_PREVIOUS_COUNT + 1)
      );
    }
    if (!state.draws.length) throw new Error("没有拿到开奖数据");

    renderIssueTabs(state.draws);

    let draw = wantedIssue
      ? state.draws.find(function (item) {
          return String(item.issue) === wantedIssue;
        }) || null
      : state.draws[0];

    if (wantedIssue && !draw) {
      draw = await findDrawByIssueOnline(type, wantedIssue);
      if (draw) {
        mergeDrawIntoList(draw);
        renderIssueTabs(state.draws);
        setIssueSelection(wantedIssue);
      }
    }

    if (!draw) {
      throw new Error(wantedIssue ? "未找到期号 " + wantedIssue : "没有拿到开奖数据");
    }

    state.currentDraw = draw;
    renderDraw(state.currentDraw);
    renderNextDraw();
    startNextDrawTimer();
    const timeLabel = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setStatus(
      `已在线更新：${LOTTERY[type].name} 第 ${state.currentDraw.issue} 期 · ${formatSourceLabel(state.source)} · ${timeLabel}`
    );

    if (state.ocrLines.length) {
      compareNumbers(state.ocrLines);
    }
  } catch (err) {
    els.drawMeta.textContent = "暂无数据";
    els.drawBalls.innerHTML = "";
    setStatus(err.message || "获取失败", true);
  } finally {
    els.refreshBtn.disabled = false;
  }
}

function renderDraw(draw) {
  const cfg = LOTTERY[state.type];
  let fuyunHint = "";
  if (state.type === "ssq") {
    const fuyunStatus = getSsqFuyunStatus(draw);
    if (fuyunStatus === "active") {
      fuyunHint = '<span class="draw-fuyun-tag">福运奖进行中（3+0 得 5 元）</span>';
    } else if (fuyunStatus === "unknown") {
      fuyunHint =
        '<span class="draw-fuyun-tag draw-fuyun-tag-unknown">福运奖状态未知，请查福彩官网</span>';
    }
  }
  els.drawMeta.innerHTML = `
    <span>第 <strong>${draw.issue}</strong> 期</span>
    <span>${draw.date || ""}</span>
    ${fuyunHint}
  `;
  els.drawBalls.innerHTML = cfg.renderDraw(draw);
}

function compareNumbers(lines) {
  if (!state.currentDraw) {
    els.compareResults.innerHTML = '<div class="status error">请先刷新开奖数据</div>';
    return;
  }

  const cfg = LOTTERY[state.type];
  const source = lines || state.ocrLines || [];
  const ticketLines = source
    .map((line) => String(line).trim())
    .filter(Boolean);

  if (!ticketLines.length) {
    els.compareResults.innerHTML = '<div class="status error">请先拍照识别号码</div>';
    return;
  }

  let winCount = 0;
  let totalFixed = 0;
  let hasFloating = false;
  let hasFuyunUnknown = false;

  const html = ticketLines
    .map((line, index) => {
      try {
        const ticket = cfg.parse(line);
        const result = cfg.check(ticket, state.currentDraw);
        const prize = resolvePrizeAmount(state.type, result, state.currentDraw);
        let winClass =
          result.level > 0 && (prize.amount > 0 || prize.floating) ? "win" : "lose";
        let prizeText = prize.text;
        let moneyClass =
          prize.amount > 0 ? "prize-money win" : prize.floating ? "prize-money floating" : "prize-money lose";

        if (result.fuyunUnknown) {
          hasFuyunUnknown = true;
          winClass = "maybe";
          moneyClass = "prize-money unknown";
          prizeText = "福运奖状态未知（3+0 可能 5 元），请查福彩官网";
        } else if (result.level > 0 && prize.amount > 0) {
          winCount += 1;
          totalFixed += prize.amount;
        } else if (result.level > 0 && prize.floating) {
          winCount += 1;
          hasFloating = true;
        }

        return `
          <div class="result-item">
            <div class="prize ${winClass}">${result.name}<span class="tag">${result.detail}</span></div>
            <div class="${moneyClass}">单注奖金：${escapeHtml(prizeText)}</div>
            <div class="balls result-balls">${cfg.renderTicket(ticket, result.hits)}</div>
          </div>
        `;
      } catch (err) {
        return `
          <div class="result-item">
            <div class="status error">${escapeHtml(err.message)}</div>
          </div>
        `;
      }
    })
    .join("");

  let summary = `共 ${ticketLines.length} 注，中奖 ${winCount} 注`;
  if (totalFixed > 0) {
    summary += `，固定奖金合计 ${formatMoney(totalFixed)}`;
  }
  if (hasFloating) {
    summary += totalFixed > 0 ? "；含浮动奖级，请以官方公告为准" : "；含浮动奖级，请以官方公告为准";
  }
  if (hasFuyunUnknown) {
    summary += "；有福运奖待确认注，请查福彩官网";
  }
  if (winCount === 0 && !hasFuyunUnknown) {
    summary += "，未中奖";
  }

  els.compareResults.innerHTML =
    `<div class="result-summary result-summary-top">${escapeHtml(summary)}</div>` + html;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function onTypeChange() {
  const type = els.lotteryType.value;
  state.type = type;
  syncLotteryTabs(type);
  state.ocrLines = [];
  state.currentDraw = null;
  state.nextDraw = null;
  state.draws = [];
  selectedIssue = "";
  if (els.issueTabs) {
    renderIssueTabs([]);
  }
  if (nextDrawTimer) {
    clearInterval(nextDrawTimer);
    nextDrawTimer = null;
  }
  els.drawMeta.textContent = "暂无数据";
  els.nextDrawMeta.classList.add("hidden");
  els.nextDrawMeta.textContent = "";
  els.drawBalls.innerHTML = "";
  els.compareResults.innerHTML =
    '<div class="empty-state">拍照识别后，对照结果会显示在这里 ~</div>';
  setStatus("切换好啦，正在刷新 ~");
}

document.querySelectorAll(".lottery-tab").forEach(function (btn) {
  btn.addEventListener("click", function () {
    if (btn.dataset.type === els.lotteryType.value) {
      closeMenu();
      return;
    }
    els.lotteryType.value = btn.dataset.type;
    onTypeChange();
    closeMenu();
    fetchDraws();
  });
});

els.lotteryType.addEventListener("change", function () {
  onTypeChange();
  fetchDraws();
});
els.refreshBtn.addEventListener("click", fetchDraws);
els.compareBtn.addEventListener("click", () => compareNumbers());
if (els.issueTabs) {
  els.issueTabs.addEventListener("click", function (event) {
    const btn = event.target.closest(".issue-tab");
    if (!btn) return;
    selectedIssue = btn.dataset.issue || "";
    renderIssueTabs(state.draws);
    applyIssueSelection();
  });
}
bindScanInputs();

els.menuBtn.addEventListener("click", openMenu);
els.menuClose.addEventListener("click", closeMenu);
els.menuBackdrop.addEventListener("click", closeMenu);
if (els.ocrErrorClose) els.ocrErrorClose.addEventListener("click", closeOcrErrorDialog);
if (els.ocrErrorBackdrop) els.ocrErrorBackdrop.addEventListener("click", closeOcrErrorDialog);
if (els.ocrStallBannerClose) {
  els.ocrStallBannerClose.addEventListener("click", openOcrErrorFromBanner);
}

onTypeChange();
loadAccessInfo();
preloadOcrAssets();
if (els.appVersion) {
  els.appVersion.textContent = "v" + APP_VERSION;
}
const heroVersion = document.getElementById("heroVersion");
if (heroVersion) {
  heroVersion.textContent = "v" + APP_VERSION;
}
fetchDraws();
if (window.LotteryOcrWatchdog) {
  window.LotteryOcrWatchdog.startPermanentMonitor(getOcrStallMs());
}
