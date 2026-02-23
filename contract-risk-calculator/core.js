(function (globalScope) {
  "use strict";

  var FIXED_LEVERAGE = 150;
  var EPSILON = 1e-10;

  function toNumber(value) {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      var trimmed = value.trim();
      if (trimmed === "") {
        return NaN;
      }
      return Number(trimmed);
    }
    return Number(value);
  }

  function isPositiveNumber(value) {
    return Number.isFinite(value) && value > 0;
  }

  function getDecimalPlaces(value) {
    var str = String(value);
    if (str.indexOf("e-") >= 0) {
      var parts = str.split("e-");
      var exponent = Number(parts[1]);
      var base = parts[0];
      var decimalPart = base.indexOf(".") >= 0 ? base.split(".")[1].length : 0;
      return exponent + decimalPart;
    }
    if (str.indexOf(".") >= 0) {
      return str.split(".")[1].length;
    }
    return 0;
  }

  function createStepMath(step, label) {
    var name = label || "步进值";
    if (!isPositiveNumber(step)) {
      throw new Error(name + "必须大于 0");
    }

    var decimals = getDecimalPlaces(step);
    var factor = Math.pow(10, decimals);
    var stepInt = Math.round(step * factor);
    if (stepInt <= 0) {
      throw new Error(name + "必须大于 0");
    }

    return {
      decimals: decimals,
      factor: factor,
      stepInt: stepInt,
      floorUnits: function (value) {
        if (!Number.isFinite(value) || value <= 0) {
          return 0;
        }
        var scaled = Math.floor(value * factor + EPSILON);
        return Math.floor(scaled / stepInt);
      },
      fromUnits: function (units) {
        var raw = (units * stepInt) / factor;
        return Number(raw.toFixed(decimals));
      }
    };
  }

  function roundDownToStep(value, step) {
    if (!Number.isFinite(value)) {
      return NaN;
    }
    var stepMath = createStepMath(step, "步进值");
    var units = stepMath.floorUnits(value);
    return stepMath.fromUnits(units);
  }

  function detectDirection(stopPrice, avgEntry) {
    if (stopPrice < avgEntry) {
      return "LONG";
    }
    if (stopPrice > avgEntry) {
      return "SHORT";
    }
    return null;
  }

  function parseTpLevels(rawLevels) {
    if (!Array.isArray(rawLevels)) {
      return [];
    }

    var levels = [];
    for (var i = 0; i < rawLevels.length && i < 3; i += 1) {
      var level = rawLevels[i] || {};
      var price = toNumber(level.price);
      var closeRatio = toNumber(level.closeRatio);
      var hasPrice = Number.isFinite(price);
      var hasRatio = Number.isFinite(closeRatio);

      if (!hasPrice && !hasRatio) {
        continue;
      }

      levels.push({
        index: i + 1,
        price: price,
        closeRatio: closeRatio,
        hasPrice: hasPrice,
        hasRatio: hasRatio
      });
    }

    return levels;
  }

  function validateInput(input) {
    var errors = [];
    var normalized = {};

    if (!input || typeof input !== "object") {
      return {
        isValid: false,
        errors: ["Input is required"],
        normalized: null
      };
    }

    normalized.symbol = String(input.symbol || "").trim() || "BTCUSDT";

    normalized.entry1Price = toNumber(input.entry1Price);
    normalized.entry2Price = toNumber(input.entry2Price);
    normalized.stopPrice = toNumber(input.stopPrice);
    normalized.riskAmountUsdt = toNumber(input.riskAmountUsdt);
    normalized.leverage = toNumber(input.leverage);
    normalized.feeRate = toNumber(input.feeRate);
    normalized.usdtStep = toNumber(input.usdtStep);
    normalized.minOrderUsdt = toNumber(input.minOrderUsdt);

    if (!isPositiveNumber(normalized.entry1Price)) {
      errors.push("Entry1 价格必须大于 0");
    }

    var entry2Provided = !(input.entry2Price === undefined || input.entry2Price === null ||
      (typeof input.entry2Price === "string" && input.entry2Price.trim() === ""));
    normalized.hasEntry2 = isPositiveNumber(normalized.entry2Price);
    if (entry2Provided && !normalized.hasEntry2) {
      errors.push("Entry2 价格必须大于 0");
    }

    normalized.entry1RatioPct = normalized.hasEntry2 ? toNumber(input.entry1Ratio) : 100;
    if (normalized.hasEntry2) {
      if (!Number.isFinite(normalized.entry1RatioPct)) {
        errors.push("Entry1 占比必须填写");
      } else if (normalized.entry1RatioPct < 0 || normalized.entry1RatioPct > 100) {
        errors.push("Entry1 占比必须在 0 到 100 之间");
      }
    } else {
      normalized.entry1RatioPct = 100;
      normalized.entry2Price = 0;
    }

    normalized.entry2RatioPct = 100 - normalized.entry1RatioPct;
    normalized.weight1 = normalized.entry1RatioPct / 100;
    normalized.weight2 = normalized.entry2RatioPct / 100;

    if (!isPositiveNumber(normalized.stopPrice)) {
      errors.push("止损价必须大于 0");
    }

    if (!isPositiveNumber(normalized.riskAmountUsdt)) {
      errors.push("固定亏损金额必须大于 0");
    }

    if (normalized.leverage !== FIXED_LEVERAGE) {
      errors.push("杠杆必须固定为 150x");
    }

    if (!Number.isFinite(normalized.feeRate) || normalized.feeRate < 0) {
      errors.push("手续费率必须大于等于 0");
    }

    if (!isPositiveNumber(normalized.usdtStep)) {
      errors.push("USDT 步进必须大于 0");
    }

    if (!isPositiveNumber(normalized.minOrderUsdt)) {
      errors.push("最小下单金额必须大于 0");
    }

    if (errors.length > 0) {
      return {
        isValid: false,
        errors: errors,
        normalized: null
      };
    }

    normalized.avgEntryByRatio = normalized.hasEntry2
      ? normalized.entry1Price * normalized.weight1 + normalized.entry2Price * normalized.weight2
      : normalized.entry1Price;

    normalized.direction = detectDirection(normalized.stopPrice, normalized.avgEntryByRatio);
    if (!normalized.direction) {
      errors.push("入场均价不能等于止损价");
    }

    if (normalized.direction === "LONG") {
      if (!(normalized.entry1Price > normalized.stopPrice)) {
        errors.push("做多时 Entry1 必须高于止损");
      }
      if (normalized.hasEntry2 && !(normalized.entry2Price > normalized.stopPrice)) {
        errors.push("做多时 Entry2 必须高于止损");
      }
    }

    if (normalized.direction === "SHORT") {
      if (!(normalized.entry1Price < normalized.stopPrice)) {
        errors.push("做空时 Entry1 必须低于止损");
      }
      if (normalized.hasEntry2 && !(normalized.entry2Price < normalized.stopPrice)) {
        errors.push("做空时 Entry2 必须低于止损");
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
      normalized: errors.length === 0 ? normalized : null
    };
  }

  function calculatePosition(input) {
    var validation = validateInput(input);
    if (!validation.isValid) {
      throw new Error(validation.errors[0]);
    }

    var n = validation.normalized;
    var stopExecPrice = n.stopPrice;

    var unitRisk1 = Math.abs(n.entry1Price - stopExecPrice) + (n.entry1Price * n.feeRate + stopExecPrice * n.feeRate);
    var unitRisk2 = n.hasEntry2
      ? Math.abs(n.entry2Price - stopExecPrice) + (n.entry2Price * n.feeRate + stopExecPrice * n.feeRate)
      : 0;

    var riskPerUsdt = n.weight1 * (unitRisk1 / n.entry1Price);
    if (n.hasEntry2) {
      riskPerUsdt += n.weight2 * (unitRisk2 / n.entry2Price);
    }

    if (!(riskPerUsdt > 0)) {
      throw new Error("单位风险异常，无法计算下单金额");
    }

    var usdtStepMath = createStepMath(n.usdtStep, "USDT 步进");
    var orderNotionalRaw = n.riskAmountUsdt / riskPerUsdt;
    var orderNotionalUnits = usdtStepMath.floorUnits(orderNotionalRaw);

    if (orderNotionalUnits <= 0) {
      throw new Error("风险额度过小，按当前条件无法下单");
    }

    var leg1Units;
    var leg2Units;
    if (n.hasEntry2) {
      leg1Units = Math.floor(orderNotionalUnits * n.weight1 + EPSILON);
      leg2Units = orderNotionalUnits - leg1Units;
    } else {
      leg1Units = orderNotionalUnits;
      leg2Units = 0;
    }

    var orderNotionalUsdt = usdtStepMath.fromUnits(orderNotionalUnits);
    var leg1NotionalUsdt = usdtStepMath.fromUnits(leg1Units);
    var leg2NotionalUsdt = usdtStepMath.fromUnits(leg2Units);

    if (orderNotionalUsdt + EPSILON < n.minOrderUsdt) {
      throw new Error("总下单金额低于最小下单金额，请增大风险金额或放宽止损");
    }

    var qty1 = leg1NotionalUsdt / n.entry1Price;
    var qty2 = n.hasEntry2 ? leg2NotionalUsdt / n.entry2Price : 0;
    var qtyTotal = qty1 + qty2;

    var notional = orderNotionalUsdt;
    var avgEntryExecuted = qtyTotal > 0 ? notional / qtyTotal : n.avgEntryByRatio;

    var feeOpenUsdt = qty1 * n.entry1Price * n.feeRate + qty2 * (n.hasEntry2 ? n.entry2Price : 0) * n.feeRate;
    var feeCloseStopUsdt = qtyTotal * stopExecPrice * n.feeRate;
    var feeTotalStopUsdt = feeOpenUsdt + feeCloseStopUsdt;

    var actualLoss = qty1 * unitRisk1 + qty2 * unitRisk2;
    var unusedRisk = n.riskAmountUsdt - actualLoss;
    var riskUtilizationPct = n.riskAmountUsdt > 0 ? (actualLoss / n.riskAmountUsdt) * 100 : 0;

    return {
      symbol: n.symbol,
      direction: n.direction,
      leverage: FIXED_LEVERAGE,
      hasEntry2: n.hasEntry2,
      entry1Price: n.entry1Price,
      entry2Price: n.hasEntry2 ? n.entry2Price : null,
      entry1RatioPct: n.entry1RatioPct,
      entry2RatioPct: n.hasEntry2 ? n.entry2RatioPct : 0,
      weight1: n.weight1,
      weight2: n.hasEntry2 ? n.weight2 : 0,
      avgEntryByRatio: n.avgEntryByRatio,
      avgEntryExecuted: avgEntryExecuted,
      stopPrice: n.stopPrice,
      stopExecPrice: stopExecPrice,
      feeRate: n.feeRate,
      usdtStep: n.usdtStep,
      minOrderUsdt: n.minOrderUsdt,
      orderNotionalRaw: orderNotionalRaw,
      orderNotionalUsdt: orderNotionalUsdt,
      leg1NotionalUsdt: leg1NotionalUsdt,
      leg2NotionalUsdt: leg2NotionalUsdt,
      qtyTotal: qtyTotal,
      qty1: qty1,
      qty2: qty2,
      unitRisk1: unitRisk1,
      unitRisk2: n.hasEntry2 ? unitRisk2 : 0,
      riskPerUsdt: riskPerUsdt,
      riskAmountUsdt: n.riskAmountUsdt,
      feeOpenUsdt: feeOpenUsdt,
      feeCloseStopUsdt: feeCloseStopUsdt,
      feeTotalStopUsdt: feeTotalStopUsdt,
      actualLoss: actualLoss,
      unusedRisk: unusedRisk,
      riskUtilizationPct: riskUtilizationPct,
      notional: notional,
      initialMargin: notional / FIXED_LEVERAGE,
      warnings: ["提示：结果按固定 150x 理论计算，请确认 Bitget 该交易对实际可用杠杆上限。"]
    };
  }

  function assertTpDirection(tpPrice, direction, avgEntry) {
    if (direction === "LONG" && tpPrice <= avgEntry) {
      throw new Error("做多止盈价必须高于入场均价");
    }
    if (direction === "SHORT" && tpPrice >= avgEntry) {
      throw new Error("做空止盈价必须低于入场均价");
    }
  }

  function calculateSingleTp(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Single TP 输入不能为空");
    }

    var position = input.position;
    if (!position || typeof position !== "object") {
      throw new Error("Single TP 缺少 position");
    }

    var tpPrice = toNumber(input.tpPrice);
    if (!isPositiveNumber(tpPrice)) {
      throw new Error("止盈价必须大于 0");
    }

    assertTpDirection(tpPrice, position.direction, position.avgEntryExecuted);

    var tpExecPrice = tpPrice;
    var unitGross = position.direction === "LONG"
      ? tpExecPrice - position.avgEntryExecuted
      : position.avgEntryExecuted - tpExecPrice;
    var unitFee = position.avgEntryExecuted * position.feeRate + tpExecPrice * position.feeRate;
    var feeTotalTpUsdt = position.qtyTotal * unitFee;
    var unitNetPnl = unitGross - unitFee;
    var pnlTotal = position.qtyTotal * unitNetPnl;

    return {
      mode: "single",
      tpPrice: tpPrice,
      tpExecPrice: tpExecPrice,
      unitNetPnl: unitNetPnl,
      feeTotalTpUsdt: feeTotalTpUsdt,
      pnlTotal: pnlTotal,
      rrTarget: pnlTotal / position.riskAmountUsdt,
      rrActual: position.actualLoss > 0 ? pnlTotal / position.actualLoss : 0
    };
  }

  function validateMultiTpLevels(tpLevels, direction, avgEntry) {
    var levels = parseTpLevels(tpLevels);
    if (levels.length === 0) {
      throw new Error("多级止盈至少填写 1 级");
    }

    var ratioSum = 0;
    for (var i = 0; i < levels.length; i += 1) {
      var level = levels[i];
      if (!level.hasPrice || !isPositiveNumber(level.price)) {
        throw new Error("TP" + level.index + " 价格必须大于 0");
      }
      if (!level.hasRatio || !(level.closeRatio > 0)) {
        throw new Error("TP" + level.index + " 平仓比例必须大于 0");
      }
      assertTpDirection(level.price, direction, avgEntry);
      ratioSum += level.closeRatio;
    }

    if (Math.abs(ratioSum - 100) > 1e-6) {
      throw new Error("多级止盈平仓比例总和必须等于 100%");
    }

    return levels;
  }

  function calculateMultiTp(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Multi TP 输入不能为空");
    }

    var position = input.position;
    if (!position || typeof position !== "object") {
      throw new Error("Multi TP 缺少 position");
    }

    var levels = validateMultiTpLevels(input.tpLevels, position.direction, position.avgEntryExecuted);
    var usdtStepMath = createStepMath(position.usdtStep, "USDT 步进");
    var totalUsdtUnits = usdtStepMath.floorUnits(position.orderNotionalUsdt);

    if (totalUsdtUnits <= 0) {
      throw new Error("下单金额异常，无法计算多级止盈");
    }

    var mapped = [];
    var usedUnits = 0;
    var totalPnl = 0;
    var totalFeeTpUsdt = 0;

    for (var i = 0; i < levels.length; i += 1) {
      var level = levels[i];
      var levelUnits;

      if (i === levels.length - 1) {
        levelUnits = totalUsdtUnits - usedUnits;
      } else {
        levelUnits = Math.floor(totalUsdtUnits * (level.closeRatio / 100) + EPSILON);
        usedUnits += levelUnits;
      }

      var closeNotionalUsdt = usdtStepMath.fromUnits(levelUnits);
      var qty = closeNotionalUsdt / position.avgEntryExecuted;
      var tpExecPrice = level.price;
      var unitGross = position.direction === "LONG"
        ? tpExecPrice - position.avgEntryExecuted
        : position.avgEntryExecuted - tpExecPrice;
      var unitFee = position.avgEntryExecuted * position.feeRate + tpExecPrice * position.feeRate;
      var feeTpUsdt = qty * unitFee;
      var unitNetPnl = unitGross - unitFee;
      var pnl = qty * unitNetPnl;

      totalFeeTpUsdt += feeTpUsdt;
      totalPnl += pnl;

      mapped.push({
        index: level.index,
        tpPrice: level.price,
        closeRatio: level.closeRatio,
        closeNotionalUsdt: closeNotionalUsdt,
        qty: qty,
        tpExecPrice: tpExecPrice,
        feeTpUsdt: feeTpUsdt,
        unitNetPnl: unitNetPnl,
        pnl: pnl,
        rrTarget: pnl / position.riskAmountUsdt,
        rrActual: position.actualLoss > 0 ? pnl / position.actualLoss : 0
      });
    }

    return {
      mode: "multi",
      levels: mapped,
      totalFeeTpUsdt: totalFeeTpUsdt,
      totalPnl: totalPnl,
      totalRrTarget: totalPnl / position.riskAmountUsdt,
      totalRrActual: position.actualLoss > 0 ? totalPnl / position.actualLoss : 0
    };
  }

  var api = {
    FIXED_LEVERAGE: FIXED_LEVERAGE,
    validateInput: validateInput,
    calculatePosition: calculatePosition,
    calculateSingleTp: calculateSingleTp,
    calculateMultiTp: calculateMultiTp,
    roundDownToStep: roundDownToStep
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.RiskCore = api;
})(typeof window !== "undefined" ? window : globalThis);
