(function () {
  "use strict";

  var core = window.RiskCore;
  if (!core) {
    throw new Error("RiskCore 未加载");
  }

  var HISTORY_KEY = "bitget-risk-calculator-history-v1";
  var HISTORY_LIMIT = 20;

  var symbolPresets = {
    BTCUSDT: { usdtStep: 1, minOrderUsdt: 5 },
    ETHUSDT: { usdtStep: 1, minOrderUsdt: 5 }
  };

  var currentSymbolLimits = { usdtStep: 1, minOrderUsdt: 5 };

  var form = document.getElementById("calculator-form");
  var symbolSelect = document.getElementById("symbol");

  var entry1Input = document.getElementById("entry1Price");
  var entry2Input = document.getElementById("entry2Price");
  var entry1RatioInput = document.getElementById("entry1Ratio");
  var entry2RatioDisplay = document.getElementById("entry2RatioDisplay");

  var tpModeSelect = document.getElementById("tpMode");
  var singleTpBlock = document.getElementById("singleTpBlock");
  var multiTpBlock = document.getElementById("multiTpBlock");

  var errorBox = document.getElementById("errorBox");
  var resultBox = document.getElementById("resultBox");
  var historyList = document.getElementById("historyList");

  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) {
      return "-";
    }
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits
    });
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = "block";
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.style.display = "none";
  }

  function showPresetForSymbol(symbol) {
    var preset = symbolPresets[symbol];
    if (!preset) {
      return;
    }

    currentSymbolLimits = {
      usdtStep: preset.usdtStep,
      minOrderUsdt: preset.minOrderUsdt
    };
  }

  function syncEntryRatioState() {
    var hasEntry2 = entry2Input.value.trim() !== "";

    if (!hasEntry2) {
      entry1RatioInput.value = "100";
      entry1RatioInput.disabled = true;
      entry2RatioDisplay.value = "0";
      return;
    }

    entry1RatioInput.disabled = false;
    var value = Number(entry1RatioInput.value);
    if (!Number.isFinite(value)) {
      value = 100;
    }
    if (value < 0) {
      value = 0;
    }
    if (value > 100) {
      value = 100;
    }

    entry1RatioInput.value = String(value);
    entry2RatioDisplay.value = String(100 - value);
  }

  function syncTpMode() {
    var mode = tpModeSelect.value;
    var isSingle = mode === "single";
    singleTpBlock.style.display = isSingle ? "block" : "none";
    multiTpBlock.style.display = isSingle ? "none" : "block";
  }

  function readTpLevels() {
    var levels = [];
    for (var i = 1; i <= 3; i += 1) {
      levels.push({
        price: document.getElementById("tp" + i + "Price").value,
        closeRatio: document.getElementById("tp" + i + "Ratio").value
      });
    }
    return levels;
  }

  function collectFormData() {
    return {
      symbol: symbolSelect.value,
      entry1Price: entry1Input.value,
      entry2Price: entry2Input.value,
      entry1Ratio: entry1RatioInput.value,
      stopPrice: document.getElementById("stopPrice").value,
      riskAmountUsdt: document.getElementById("riskAmountUsdt").value,
      feeRatePct: document.getElementById("feeRatePct").value,
      usdtStep: currentSymbolLimits.usdtStep,
      minOrderUsdt: currentSymbolLimits.minOrderUsdt,
      tpMode: tpModeSelect.value,
      singleTpPrice: document.getElementById("singleTpPrice").value,
      tpLevels: readTpLevels()
    };
  }

  function applyFormData(data) {
    symbolSelect.value = data.symbol || "BTCUSDT";
    entry1Input.value = data.entry1Price || "";
    entry2Input.value = data.entry2Price || "";
    entry1RatioInput.value = data.entry1Ratio || "100";
    document.getElementById("stopPrice").value = data.stopPrice || "";
    document.getElementById("riskAmountUsdt").value = data.riskAmountUsdt || "300";
    document.getElementById("feeRatePct").value = data.feeRatePct || "0.04";
    tpModeSelect.value = data.tpMode || "single";
    document.getElementById("singleTpPrice").value = data.singleTpPrice || "";

    for (var i = 1; i <= 3; i += 1) {
      var level = (data.tpLevels && data.tpLevels[i - 1]) || { price: "", closeRatio: "" };
      document.getElementById("tp" + i + "Price").value = level.price || "";
      document.getElementById("tp" + i + "Ratio").value = level.closeRatio || "";
    }

    showPresetForSymbol(symbolSelect.value);
    syncEntryRatioState();
    syncTpMode();
  }

  function buildInputForCore(formData) {
    return {
      symbol: formData.symbol,
      entry1Price: formData.entry1Price,
      entry2Price: formData.entry2Price,
      entry1Ratio: formData.entry1Ratio,
      stopPrice: formData.stopPrice,
      riskAmountUsdt: formData.riskAmountUsdt,
      leverage: core.FIXED_LEVERAGE,
      feeRate: Number(formData.feeRatePct) / 100,
      usdtStep: formData.usdtStep,
      minOrderUsdt: formData.minOrderUsdt
    };
  }

  function renderSingleTp(singleTp) {
    return "<section class=\"result-section\">" +
      "<h3 class=\"result-section-title\">止盈结果（单一）</h3>" +
      "<div class=\"result-grid result-grid--compact\">" +
      "<div><span>止盈价</span><strong>" + formatNumber(singleTp.tpPrice, 2) + "</strong></div>" +
      "<div><span>止盈场景手续费(开+平)</span><strong>" + formatNumber(singleTp.feeTotalTpUsdt, 4) + "</strong></div>" +
      "<div><span>预计止盈盈亏(USDT)</span><strong>" + formatNumber(singleTp.pnlTotal, 4) + "</strong></div>" +
      "<div><span>RR(按目标风险)</span><strong>" + formatNumber(singleTp.rrTarget, 4) + "R</strong></div>" +
      "</div>" +
      "</section>";
  }

  function renderMultiTp(multiTp) {
    var rows = multiTp.levels
      .map(function (level) {
        return "<tr>" +
          "<td>TP" + level.index + "</td>" +
          "<td>" + formatNumber(level.tpPrice, 2) + "</td>" +
          "<td>" + formatNumber(level.closeRatio, 2) + "%</td>" +
          "<td>" + formatNumber(level.feeTpUsdt, 4) + "</td>" +
          "<td>" + formatNumber(level.pnl, 4) + "</td>" +
          "<td>" + formatNumber(level.rrTarget, 4) + "R</td>" +
          "</tr>";
      })
      .join("");

    return "<section class=\"result-section\">" +
      "<h3 class=\"result-section-title\">止盈结果（多级）</h3>" +
      "<div class=\"tp-table-wrap\"><table class=\"tp-table\">" +
      "<thead><tr><th>级别</th><th>价格</th><th>平仓比例</th><th>手续费(USDT)</th><th>盈亏(USDT)</th><th>RR</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>" +
      "<div class=\"result-grid result-grid--compact tp-summary-grid--compact\">" +
      "<div><span>总止盈盈亏(USDT)</span><strong>" + formatNumber(multiTp.totalPnl, 4) + "</strong></div>" +
      "<div><span>总RR(按目标风险)</span><strong>" + formatNumber(multiTp.totalRrTarget, 4) + "R</strong></div>" +
      "</div>" +
      "</section>";
  }

  function renderResult(position, tpResult, tpMode) {
    var leg1MarginUsdt = position.leg1NotionalUsdt / position.leverage;
    var leg2MarginUsdt = position.leg2NotionalUsdt / position.leverage;

    var html = "" +
      "<section class=\"result-section\">" +
      "<h3 class=\"result-section-title\">仓位结果</h3>" +
      "<div class=\"result-grid result-grid--compact\">" +
      "<div><span>方向</span><strong>" + position.direction + "</strong></div>" +
      "<div><span>腿1保证金(USDT)</span><strong>" + formatNumber(leg1MarginUsdt, 4) + "</strong></div>" +
      "<div><span>腿2保证金(USDT)</span><strong>" + formatNumber(leg2MarginUsdt, 4) + "</strong></div>" +
      "<div><span>止损场景手续费(开+平)</span><strong>" + formatNumber(position.feeTotalStopUsdt, 4) + "</strong></div>" +
      "<div><span>实际止损金额(USDT)</span><strong>" + formatNumber(position.actualLoss, 4) + "</strong></div>" +
      "<div><span>止损价</span><strong>" + formatNumber(position.stopPrice, 4) + "</strong></div>" +
      "</div>" +
      "</section>";

    if (tpMode === "single") {
      html += renderSingleTp(tpResult);
    } else {
      html += renderMultiTp(tpResult);
    }

    resultBox.innerHTML = html;
    resultBox.style.display = "block";
  }

  function getHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) {
        return [];
      }
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed;
    } catch (error) {
      return [];
    }
  }

  function saveHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  }

  function pushHistory(formData, position, tpResult, tpMode) {
    var history = getHistory();
    history.unshift({
      timestamp: Date.now(),
      formData: formData,
      summary: {
        symbol: position.symbol,
        direction: position.direction,
        leg1MarginUsdt: position.leg1NotionalUsdt / position.leverage,
        leg2MarginUsdt: position.leg2NotionalUsdt / position.leverage
      }
    });
    saveHistory(history);
  }

  function renderHistory() {
    var history = getHistory();
    if (history.length === 0) {
      historyList.innerHTML = "<li class=\"history-empty\">暂无历史记录</li>";
      return;
    }

    var html = history
      .map(function (item, index) {
        var time = new Date(item.timestamp).toLocaleString();
        var summary = item.summary || {};
        var symbol = summary.symbol || "-";
        var direction = summary.direction || "-";
        var leg1Margin = Number(summary.leg1MarginUsdt);
        var leg2Margin = Number(summary.leg2MarginUsdt);

        return "<li>" +
          "<div class=\"history-main\">" +
          "<strong>" + symbol + " / " + direction + "</strong>" +
          "<span>腿1保证金: " + formatNumber(leg1Margin, 4) + " USDT</span>" +
          "<span>腿2保证金: " + formatNumber(leg2Margin, 4) + " USDT</span>" +
          "<span class=\"history-time\">" + time + "</span>" +
          "</div>" +
          "<button type=\"button\" class=\"history-load\" data-index=\"" + index + "\">回填</button>" +
          "</li>";
      })
      .join("");

    historyList.innerHTML = html;
  }

  function runCalculation() {
    clearError();

    var formData = collectFormData();
    var input = buildInputForCore(formData);

    var position = core.calculatePosition(input);

    var tpMode = formData.tpMode;
    var tpResult;

    if (tpMode === "single") {
      tpResult = core.calculateSingleTp({
        position: position,
        tpPrice: formData.singleTpPrice
      });
    } else {
      tpResult = core.calculateMultiTp({
        position: position,
        tpLevels: formData.tpLevels
      });
    }

    renderResult(position, tpResult, tpMode);
    pushHistory(formData, position, tpResult, tpMode);
    renderHistory();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    try {
      runCalculation();
    } catch (error) {
      resultBox.style.display = "none";
      showError(error.message || "计算失败，请检查输入参数");
    }
  });

  symbolSelect.addEventListener("change", function () {
    showPresetForSymbol(symbolSelect.value);
  });

  entry2Input.addEventListener("input", syncEntryRatioState);
  entry1RatioInput.addEventListener("input", syncEntryRatioState);
  tpModeSelect.addEventListener("change", syncTpMode);

  historyList.addEventListener("click", function (event) {
    var target = event.target;
    if (!target.classList.contains("history-load")) {
      return;
    }

    var index = Number(target.getAttribute("data-index"));
    var history = getHistory();
    if (!Number.isInteger(index) || !history[index]) {
      return;
    }

    applyFormData(history[index].formData);
    clearError();
    resultBox.style.display = "none";
  });

  document.getElementById("clearHistory").addEventListener("click", function () {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });

  showPresetForSymbol(symbolSelect.value);
  syncEntryRatioState();
  syncTpMode();
  renderHistory();
})();
