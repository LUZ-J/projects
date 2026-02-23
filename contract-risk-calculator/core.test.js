const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FIXED_LEVERAGE,
  calculatePosition,
  calculateSingleTp,
  calculateMultiTp,
  roundDownToStep
} = require("./core.js");

function approxEqual(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ~= ${expected}`);
}

function makeBaseInput(overrides = {}) {
  return {
    symbol: "BTCUSDT",
    entry1Price: 100,
    entry2Price: "",
    entry1Ratio: 100,
    stopPrice: 95,
    riskAmountUsdt: 50,
    leverage: FIXED_LEVERAGE,
    feeRate: 0,
    usdtStep: 1,
    minOrderUsdt: 5,
    ...overrides
  };
}

test("single entry calculates USDT notional with 150x", () => {
  const position = calculatePosition(makeBaseInput());

  approxEqual(position.orderNotionalUsdt, 1000);
  approxEqual(position.leg1NotionalUsdt, 1000);
  approxEqual(position.leg2NotionalUsdt, 0);
  approxEqual(position.qtyTotal, 10);
  approxEqual(position.feeTotalStopUsdt, 0);
  approxEqual(position.actualLoss, 50);
  approxEqual(position.initialMargin, 1000 / 150);
});

test("double entry splits by USDT ratio and keeps risk cap", () => {
  const position = calculatePosition(
    makeBaseInput({
      entry2Price: 102,
      entry1Ratio: 60,
      stopPrice: 95
    })
  );

  approxEqual(position.orderNotionalUsdt, 870);
  approxEqual(position.leg1NotionalUsdt, 522);
  approxEqual(position.leg2NotionalUsdt, 348);
  approxEqual(position.qty1, 5.22);
  approxEqual(position.qty2, 348 / 102);
  assert.ok(position.actualLoss <= 50);
  assert.ok(position.actualLoss > 49.9);
});

test("fee reduces allowable USDT notional", () => {
  const noFee = calculatePosition(makeBaseInput({ feeRate: 0 }));
  const withFee = calculatePosition(makeBaseInput({ feeRate: 0.0005 }));

  assert.ok(withFee.orderNotionalUsdt < noFee.orderNotionalUsdt);
});

test("throws when resulting notional is below minOrderUsdt", () => {
  assert.throws(
    () => calculatePosition(makeBaseInput({ riskAmountUsdt: 0.2, minOrderUsdt: 5 })),
    /总下单金额低于最小下单金额/
  );
});

test("stop fee total equals open + close fee", () => {
  const position = calculatePosition(makeBaseInput({ feeRate: 0.001 }));

  assert.ok(position.feeTotalStopUsdt > 0);
  approxEqual(position.feeTotalStopUsdt, position.feeOpenUsdt + position.feeCloseStopUsdt);
});

test("single tp includes total fee of open+tp close", () => {
  const position = calculatePosition(makeBaseInput({ feeRate: 0.001 }));
  const tp = calculateSingleTp({ position, tpPrice: 110 });

  const expectedFee = position.qtyTotal * ((position.avgEntryExecuted * position.feeRate) + (110 * position.feeRate));
  approxEqual(tp.feeTotalTpUsdt, expectedFee);
  assert.ok(tp.feeTotalTpUsdt > 0);
});

test("multi tp includes fee per level and total fee", () => {
  const position = calculatePosition(makeBaseInput({ feeRate: 0.001 }));
  const multi = calculateMultiTp({
    position,
    tpLevels: [
      { price: 110, closeRatio: 50 },
      { price: 120, closeRatio: 50 }
    ]
  });

  assert.equal(multi.levels.length, 2);
  assert.ok(multi.totalFeeTpUsdt > 0);
  approxEqual(
    multi.totalFeeTpUsdt,
    multi.levels.reduce((sum, level) => sum + level.feeTpUsdt, 0)
  );
});

test("multi tp ratio sum must equal 100", () => {
  const position = calculatePosition(makeBaseInput());

  assert.throws(
    () =>
      calculateMultiTp({
        position,
        tpLevels: [
          { price: 110, closeRatio: 60 },
          { price: 120, closeRatio: 30 }
        ]
      }),
    /总和必须等于 100/
  );
});

test("entry validation blocks invalid second leg direction", () => {
  assert.throws(
    () =>
      calculatePosition(
        makeBaseInput({
          entry2Price: 98,
          entry1Ratio: 50,
          stopPrice: 98.5
        })
      ),
    /Entry2 必须高于止损/
  );
});

test("entry2 must be positive when provided", () => {
  assert.throws(
    () => calculatePosition(makeBaseInput({ entry2Price: 0 })),
    /Entry2 价格必须大于 0/
  );
});

test("roundDownToStep floors correctly", () => {
  approxEqual(roundDownToStep(123.456, 1), 123);
  approxEqual(roundDownToStep(1.23456, 0.001), 1.234);
});
