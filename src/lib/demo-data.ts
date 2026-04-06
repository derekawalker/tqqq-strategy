import type { SchwabData } from "@/app/api/schwab/data/route";
import type { SchwabAccount } from "@/app/api/schwab/accounts/route";
import type { Account } from "@/lib/context/AppContext";

const A = "111111111";  // Main Account  — blue,   $200k
const B = "222222222";  // IRA           — teal,   $100k
const C = "333333333";  // Joint         — violet, $300k

// Fixed anchor date so data always looks ~recent
function daysAgo(n: number): string {
  const d = new Date("2026-03-31T16:00:00Z");
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Account list (returned by /api/schwab/accounts)
// ---------------------------------------------------------------------------
export const DEMO_ACCOUNTS: SchwabAccount[] = [
  { accountNumber: A, nickName: "Main Account" },
  { accountNumber: B, nickName: "IRA" },
  { accountNumber: C, nickName: "Joint" },
];

// ---------------------------------------------------------------------------
// Account settings (returned by /api/settings?key=accounts)
//
// All three: initialLotPrice=50, sellPercentage=1.64, reductionFactor=0.95
// Share counts per level from computeLevels() [K=(1-R)/(1-R^88), R=0.95]:
//
//  Account A ($200k): L0=202 L1=194 L2=186 L3=179 L4=172 L5=165 L6=158 ...
//  Account B ($100k): L0=101 L1=97  L2=93  L3=89  L4=86  L5=82  L6=79  ...
//  Account C ($300k): L0=303 L1=291 L2=279 L3=268 L4=257 L5=247 L6=237 ...
// ---------------------------------------------------------------------------
export const DEMO_ACCOUNT_CONFIG: Account[] = [
  {
    accountNumber: A,
    accountName: "Main Account",
    color: "blue",
    settings: {
      startingCash: 200000,
      startingDate: new Date("2026-01-01"),
      initialLotPrice: 50.0,
      sellPercentage: 1.64,
      reductionFactor: 0.95,
      orderWarnBelow: 3,
      orderBuffer: 5,
      callSafetyLevels: 8,
      putSafetyLevels: 8,
    },
  },
  {
    accountNumber: B,
    accountName: "IRA",
    color: "teal",
    settings: {
      startingCash: 100000,
      startingDate: new Date("2026-02-01"),
      initialLotPrice: 50.0,
      sellPercentage: 1.64,
      reductionFactor: 0.95,
      orderWarnBelow: 3,
      orderBuffer: 5,
      callSafetyLevels: 8,
      putSafetyLevels: 8,
    },
  },
  {
    accountNumber: C,
    accountName: "Joint",
    color: "violet",
    settings: {
      startingCash: 300000,
      startingDate: new Date("2026-01-01"),
      initialLotPrice: 50.0,
      sellPercentage: 1.64,
      reductionFactor: 0.95,
      orderWarnBelow: 3,
      orderBuffer: 5,
      callSafetyLevels: 8,
      putSafetyLevels: 8,
    },
  },
];

// ---------------------------------------------------------------------------
// Trading data (returned by /api/schwab/data)
//
// Scenario: all accounts started at initialLotPrice=$50. Price declined over
// 3 months, accumulating levels. A brief bounce to ~$52 triggered sells on
// the upper levels; those levels were then re-bought as price dipped back
// (creating duplicate BUY orders). Price has since recovered to ~$52.
//
// Account A ($200k) — held L0-L11, sold L0-L2, re-bought L0+L1 (duplicates),
//   L2 not re-bought; currently holding L0(re)+L1(re)+L3-L11 + 3 working
//   orders; open options include 2 ITM (put $55, call $50) and 2 OTM
//
// Account B ($100k) — accumulated L0-L6, never sold, 3 working orders, no options
//
// Account C ($300k) — held L0-L12, sold L0-L2, re-bought L0+L1 (duplicates),
//   currently holding L0(re)+L1(re)+L3-L12 + 3 working orders; open options
//   include 1 deep ITM put ($57) and 2 OTM
// ---------------------------------------------------------------------------
export const DEMO_DATA: SchwabData = {
  filledOrders: [
    // ── Account A ────────────────────────────────────────────────────────────
    // First pass: accumulated L0–L8 as price declined
    // BUY orders: no SEC/TAF fees (only on sells)
    { orderId: 10000001, accountNumber: A, side: "BUY",  shares: 202, fillPrice: 50.00, total: 10100.00, fees:  0.00, time: daysAgo(88) },
    { orderId: 10000002, accountNumber: A, side: "BUY",  shares: 194, fillPrice: 49.50, total:  9603.00, fees:  0.00, time: daysAgo(81) },
    { orderId: 10000003, accountNumber: A, side: "BUY",  shares: 186, fillPrice: 49.00, total:  9114.00, fees:  0.00, time: daysAgo(74) },
    { orderId: 10000004, accountNumber: A, side: "BUY",  shares: 179, fillPrice: 48.50, total:  8681.50, fees:  0.00, time: daysAgo(67) },
    { orderId: 10000005, accountNumber: A, side: "BUY",  shares: 172, fillPrice: 48.00, total:  8256.00, fees:  0.00, time: daysAgo(60) },
    { orderId: 10000006, accountNumber: A, side: "BUY",  shares: 165, fillPrice: 47.50, total:  7837.50, fees:  0.00, time: daysAgo(53) },
    { orderId: 10000007, accountNumber: A, side: "BUY",  shares: 158, fillPrice: 47.00, total:  7426.00, fees:  0.00, time: daysAgo(46) },
    { orderId: 10000008, accountNumber: A, side: "BUY",  shares: 152, fillPrice: 46.50, total:  7068.00, fees:  0.00, time: daysAgo(39) },
    { orderId: 10000009, accountNumber: A, side: "BUY",  shares: 146, fillPrice: 46.00, total:  6716.00, fees:  0.00, time: daysAgo(32) },
    // Price bounced to ~$52 — sold upper levels (SEC fee ≈ total×$0.0000278, TAF ≈ shares×$0.000166)
    { orderId: 10000010, accountNumber: A, side: "SELL", shares: 186, fillPrice: 49.80, total:  9262.80, fees: -0.29, time: daysAgo(25) },
    { orderId: 10000011, accountNumber: A, side: "SELL", shares: 194, fillPrice: 50.31, total:  9760.14, fees: -0.30, time: daysAgo(22) },
    { orderId: 10000012, accountNumber: A, side: "SELL", shares: 202, fillPrice: 50.82, total: 10265.64, fees: -0.32, time: daysAgo(19) },
    // Price dipped back — re-bought L0 and L1 (duplicate buy orders)
    { orderId: 10000013, accountNumber: A, side: "BUY",  shares: 202, fillPrice: 50.00, total: 10100.00, fees:  0.00, time: daysAgo(15) },
    { orderId: 10000014, accountNumber: A, side: "BUY",  shares: 194, fillPrice: 49.50, total:  9603.00, fees:  0.00, time: daysAgo(12) },
    // Price continued lower — added L9–L11
    { orderId: 10000015, accountNumber: A, side: "BUY",  shares: 140, fillPrice: 45.50, total:  6370.00, fees:  0.00, time: daysAgo(8)  },
    { orderId: 10000016, accountNumber: A, side: "BUY",  shares: 135, fillPrice: 45.00, total:  6075.00, fees:  0.00, time: daysAgo(5)  },
    { orderId: 10000017, accountNumber: A, side: "BUY",  shares: 129, fillPrice: 44.50, total:  5740.50, fees:  0.00, time: daysAgo(2)  },

    // ── Account B ────────────────────────────────────────────────────────────
    // Accumulated L0–L6, still holding all — no sells, no duplicates
    { orderId: 20000001, accountNumber: B, side: "BUY",  shares: 101, fillPrice: 50.00, total:  5050.00, fees:  0.00, time: daysAgo(60) },
    { orderId: 20000002, accountNumber: B, side: "BUY",  shares:  97, fillPrice: 49.50, total:  4801.50, fees:  0.00, time: daysAgo(53) },
    { orderId: 20000003, accountNumber: B, side: "BUY",  shares:  93, fillPrice: 49.00, total:  4557.00, fees:  0.00, time: daysAgo(46) },
    { orderId: 20000004, accountNumber: B, side: "BUY",  shares:  89, fillPrice: 48.50, total:  4316.50, fees:  0.00, time: daysAgo(39) },
    { orderId: 20000005, accountNumber: B, side: "BUY",  shares:  86, fillPrice: 48.00, total:  4128.00, fees:  0.00, time: daysAgo(32) },
    { orderId: 20000006, accountNumber: B, side: "BUY",  shares:  82, fillPrice: 47.50, total:  3895.00, fees:  0.00, time: daysAgo(25) },
    { orderId: 20000007, accountNumber: B, side: "BUY",  shares:  79, fillPrice: 47.00, total:  3713.00, fees:  0.00, time: daysAgo(18) },

    // ── Account C ────────────────────────────────────────────────────────────
    // First pass: accumulated L0–L8 as price declined
    { orderId: 30000001, accountNumber: C, side: "BUY",  shares: 303, fillPrice: 50.00, total: 15150.00, fees:  0.00, time: daysAgo(88) },
    { orderId: 30000002, accountNumber: C, side: "BUY",  shares: 291, fillPrice: 49.50, total: 14404.50, fees:  0.00, time: daysAgo(82) },
    { orderId: 30000003, accountNumber: C, side: "BUY",  shares: 279, fillPrice: 49.00, total: 13671.00, fees:  0.00, time: daysAgo(76) },
    { orderId: 30000004, accountNumber: C, side: "BUY",  shares: 268, fillPrice: 48.50, total: 12998.00, fees:  0.00, time: daysAgo(70) },
    { orderId: 30000005, accountNumber: C, side: "BUY",  shares: 257, fillPrice: 48.00, total: 12336.00, fees:  0.00, time: daysAgo(63) },
    { orderId: 30000006, accountNumber: C, side: "BUY",  shares: 247, fillPrice: 47.50, total: 11732.50, fees:  0.00, time: daysAgo(56) },
    { orderId: 30000007, accountNumber: C, side: "BUY",  shares: 237, fillPrice: 47.00, total: 11139.00, fees:  0.00, time: daysAgo(49) },
    { orderId: 30000008, accountNumber: C, side: "BUY",  shares: 228, fillPrice: 46.50, total: 10602.00, fees:  0.00, time: daysAgo(42) },
    { orderId: 30000009, accountNumber: C, side: "BUY",  shares: 219, fillPrice: 46.00, total: 10074.00, fees:  0.00, time: daysAgo(35) },
    // Price bounced to ~$52 — sold upper levels
    { orderId: 30000010, accountNumber: C, side: "SELL", shares: 279, fillPrice: 49.80, total: 13894.20, fees: -0.43, time: daysAgo(28) },
    { orderId: 30000011, accountNumber: C, side: "SELL", shares: 291, fillPrice: 50.31, total: 14640.21, fees: -0.45, time: daysAgo(25) },
    { orderId: 30000012, accountNumber: C, side: "SELL", shares: 303, fillPrice: 50.82, total: 15398.46, fees: -0.48, time: daysAgo(22) },
    // Price dipped back — re-bought L0 and L1 (duplicate buy orders)
    { orderId: 30000013, accountNumber: C, side: "BUY",  shares: 303, fillPrice: 50.00, total: 15150.00, fees:  0.00, time: daysAgo(18) },
    { orderId: 30000014, accountNumber: C, side: "BUY",  shares: 291, fillPrice: 49.50, total: 14404.50, fees:  0.00, time: daysAgo(16) },
    // Price continued lower — added L9–L12
    { orderId: 30000015, accountNumber: C, side: "BUY",  shares: 210, fillPrice: 45.50, total:  9555.00, fees:  0.00, time: daysAgo(10) },
    { orderId: 30000016, accountNumber: C, side: "BUY",  shares: 202, fillPrice: 45.00, total:  9090.00, fees:  0.00, time: daysAgo(7)  },
    { orderId: 30000017, accountNumber: C, side: "BUY",  shares: 194, fillPrice: 44.50, total:  8633.00, fees:  0.00, time: daysAgo(4)  },
    { orderId: 30000018, accountNumber: C, side: "BUY",  shares: 186, fillPrice: 44.00, total:  8184.00, fees:  0.00, time: daysAgo(1)  },
  ],

  filledOptionOrders: [
    // Options fees: optRegFee ≈ $0.02955/contract + tafFee ≈ $0.002/contract ≈ ~$0.032/contract
    // ── Account A ────────────────────────────────────────────────────────────
    // Currently open positions
    { orderId: 10001001, accountNumber: A, instruction: "SELL_TO_OPEN", symbol: "TQQQ260417P00055000", contracts: 2, fillPrice: 1.45, total:  290.00, fees: -0.06, time: daysAgo(30) },
    { orderId: 10001002, accountNumber: A, instruction: "SELL_TO_OPEN", symbol: "TQQQ260515P00045000", contracts: 3, fillPrice: 0.90, total:  270.00, fees: -0.10, time: daysAgo(14) },
    { orderId: 10001003, accountNumber: A, instruction: "SELL_TO_OPEN", symbol: "TQQQ260417C00050000", contracts: 2, fillPrice: 0.72, total:  144.00, fees: -0.06, time: daysAgo(10) },
    { orderId: 10001004, accountNumber: A, instruction: "SELL_TO_OPEN", symbol: "TQQQ260515C00062000", contracts: 2, fillPrice: 0.55, total:  110.00, fees: -0.06, time: daysAgo(30) },
    // Expired (March 20 cycle)
    { orderId: 10001005, accountNumber: A, instruction: "SELL_TO_OPEN", symbol: "TQQQ260320P00048000", contracts: 3, fillPrice: 1.15, total:  345.00, fees: -0.10, time: daysAgo(42) },
    { orderId: 10001006, accountNumber: A, instruction: "SELL_TO_OPEN", symbol: "TQQQ260320C00058000", contracts: 1, fillPrice: 0.80, total:   80.00, fees: -0.03, time: daysAgo(42) },
    // ── Account C ────────────────────────────────────────────────────────────
    // Currently open positions
    { orderId: 30001001, accountNumber: C, instruction: "SELL_TO_OPEN", symbol: "TQQQ260417P00057000", contracts: 3, fillPrice: 0.95, total:  285.00, fees: -0.10, time: daysAgo(28) },
    { orderId: 30001002, accountNumber: C, instruction: "SELL_TO_OPEN", symbol: "TQQQ260515P00044000", contracts: 4, fillPrice: 0.85, total:  340.00, fees: -0.13, time: daysAgo(14) },
    { orderId: 30001003, accountNumber: C, instruction: "SELL_TO_OPEN", symbol: "TQQQ260515C00064000", contracts: 3, fillPrice: 0.42, total:  126.00, fees: -0.10, time: daysAgo(28) },
    // Expired (March 20 cycle)
    { orderId: 30001004, accountNumber: C, instruction: "SELL_TO_OPEN", symbol: "TQQQ260320P00050000", contracts: 4, fillPrice: 1.10, total:  440.00, fees: -0.13, time: daysAgo(42) },
    { orderId: 30001005, accountNumber: C, instruction: "SELL_TO_OPEN", symbol: "TQQQ260320C00060000", contracts: 2, fillPrice: 0.65, total:  130.00, fees: -0.06, time: daysAgo(42) },
  ],

  expiredOptionOrders: [
    // ── Account A ────────────────────────────────────────────────────────────
    { activityId: 10002001, accountNumber: A, symbol: "TQQQ260320P00048000", contracts: 3, time: daysAgo(11) },
    { activityId: 10002002, accountNumber: A, symbol: "TQQQ260320C00058000", contracts: 1, time: daysAgo(11) },
    // ── Account C ────────────────────────────────────────────────────────────
    { activityId: 30002001, accountNumber: C, symbol: "TQQQ260320P00050000", contracts: 4, time: daysAgo(11) },
    { activityId: 30002002, accountNumber: C, symbol: "TQQQ260320C00060000", contracts: 2, time: daysAgo(11) },
  ],

  workingOrders: [
    // ── Account A ────────────────────────────────────────────────────────────
    { orderId: 10003001, accountNumber: A, side: "BUY", shares: 124, limitPrice: 44.00, enteredTime: daysAgo(2), status: "WORKING" },
    { orderId: 10003002, accountNumber: A, side: "BUY", shares: 119, limitPrice: 43.50, enteredTime: daysAgo(2), status: "WORKING" },
    { orderId: 10003003, accountNumber: A, side: "BUY", shares: 115, limitPrice: 43.00, enteredTime: daysAgo(2), status: "WORKING" },
    // ── Account B ────────────────────────────────────────────────────────────
    { orderId: 20003001, accountNumber: B, side: "BUY", shares:  76, limitPrice: 46.50, enteredTime: daysAgo(1), status: "WORKING" },
    { orderId: 20003002, accountNumber: B, side: "BUY", shares:  73, limitPrice: 46.00, enteredTime: daysAgo(1), status: "WORKING" },
    { orderId: 20003003, accountNumber: B, side: "BUY", shares:  70, limitPrice: 45.50, enteredTime: daysAgo(1), status: "WORKING" },
    // ── Account C ────────────────────────────────────────────────────────────
    { orderId: 30003001, accountNumber: C, side: "BUY", shares: 179, limitPrice: 43.50, enteredTime: daysAgo(2), status: "WORKING" },
    { orderId: 30003002, accountNumber: C, side: "BUY", shares: 172, limitPrice: 43.00, enteredTime: daysAgo(2), status: "WORKING" },
    { orderId: 30003003, accountNumber: C, side: "BUY", shares: 165, limitPrice: 42.50, enteredTime: daysAgo(2), status: "WORKING" },
  ],

  optionPositions: [
    // ── Account A ────────────────────────────────────────────────────────────
    // ITM put: strike $55 > current ~$52, opened when stock was at $57 (was OTM)
    { accountNumber: A, symbol: "TQQQ260417P00055000", putCall: "PUT",  strike: 55, expiry: "2026-04-17", shortQty: 2, longQty: 0, marketValue:  -660.00, averagePrice: 1.45, openedAt: daysAgo(30) },
    // OTM put: strike $45 < current ~$52
    { accountNumber: A, symbol: "TQQQ260515P00045000", putCall: "PUT",  strike: 45, expiry: "2026-05-15", shortQty: 3, longQty: 0, marketValue:  -225.00, averagePrice: 0.90, openedAt: daysAgo(14) },
    // ITM call: strike $50 < current ~$52, opened when stock was at $46 (was OTM)
    { accountNumber: A, symbol: "TQQQ260417C00050000", putCall: "CALL", strike: 50, expiry: "2026-04-17", shortQty: 2, longQty: 0, marketValue:  -450.00, averagePrice: 0.72, openedAt: daysAgo(10) },
    // OTM call: strike $62 > current ~$52
    { accountNumber: A, symbol: "TQQQ260515C00062000", putCall: "CALL", strike: 62, expiry: "2026-05-15", shortQty: 2, longQty: 0, marketValue:   -76.00, averagePrice: 0.55, openedAt: daysAgo(30) },
    // ── Account C ────────────────────────────────────────────────────────────
    // Deep ITM put: strike $57 > current ~$52, opened at $58 slightly OTM
    { accountNumber: C, symbol: "TQQQ260417P00057000", putCall: "PUT",  strike: 57, expiry: "2026-04-17", shortQty: 3, longQty: 0, marketValue: -1530.00, averagePrice: 0.95, openedAt: daysAgo(28) },
    // OTM put: strike $44 < current ~$52
    { accountNumber: C, symbol: "TQQQ260515P00044000", putCall: "PUT",  strike: 44, expiry: "2026-05-15", shortQty: 4, longQty: 0, marketValue:  -272.00, averagePrice: 0.85, openedAt: daysAgo(14) },
    // OTM call: strike $64 > current ~$52
    { accountNumber: C, symbol: "TQQQ260515C00064000", putCall: "CALL", strike: 64, expiry: "2026-05-15", shortQty: 3, longQty: 0, marketValue:   -84.00, averagePrice: 0.42, openedAt: daysAgo(28) },
  ],

  // Held shares: A = L0(re)+L1(re)+L3-L11, B = L0-L6, C = L0(re)+L1(re)+L3-L12
  tqqqShares: {
    [A]: 1772,  // 202+194+179+172+165+158+152+146+140+135+129
    [B]:  627,  // 101+97+93+89+86+82+79
    [C]: 2842,  // 303+291+268+257+247+237+228+219+210+202+194+186
  },
  tqqqAvgPrice: {
    [A]: 47.33,
    [B]: 48.58,
    [C]: 47.11,
  },

  balances: [
    {
      accountNumber: A,
      totalValue:             208500.00,
      cash:                    3800.00,
      tqqqValue:              92144.00,  // 1772 × ~$52
      moneyMarketValue:       111200.00,
      optionsValue:            1411.00,
      otherValue:                 0.00,
      availableFunds:          3800.00,
      cashAvailableForTrading: 3800.00,
    },
    {
      accountNumber: B,
      totalValue:             102100.00,
      cash:                    4000.00,
      tqqqValue:              32604.00,  // 627 × ~$52
      moneyMarketValue:        65500.00,
      optionsValue:               0.00,
      otherValue:                 0.00,
      availableFunds:          4000.00,
      cashAvailableForTrading: 4000.00,
    },
    {
      accountNumber: C,
      totalValue:             314000.00,
      cash:                    5500.00,
      tqqqValue:             147784.00,  // 2842 × ~$52
      moneyMarketValue:       159100.00,
      optionsValue:            1886.00,
      otherValue:                 0.00,
      availableFunds:          5500.00,
      cashAvailableForTrading: 5500.00,
    },
  ],

  transactions: [
    // ── Account A ────────────────────────────────────────────────────────────
    { activityId: 10004001, accountNumber: A, time: daysAgo(1),  description: "SCHWAB PRIME ADVANTAGE MONEY INVESTOR", symbol: null, amount: 120.45, category: "dividend" },
    { activityId: 10004002, accountNumber: A, time: daysAgo(32), description: "SCHWAB PRIME ADVANTAGE MONEY INVESTOR", symbol: null, amount: 115.20, category: "dividend" },
    { activityId: 10004003, accountNumber: A, time: daysAgo(62), description: "SCHWAB PRIME ADVANTAGE MONEY INVESTOR", symbol: null, amount: 108.90, category: "dividend" },
    { activityId: 10004004, accountNumber: A, time: daysAgo(8),  description: "PROSHARES ULTRAPRO QQQ",                symbol: null, amount:  22.40, category: "dividend" },
    { activityId: 10004005, accountNumber: A, time: daysAgo(38), description: "PROSHARES ULTRAPRO QQQ",                symbol: null, amount:  18.60, category: "dividend" },
    { activityId: 10004006, accountNumber: A, time: daysAgo(16), description: "BANK INT 021526-031526 SCHWAB BANK",    symbol: null, amount:   0.15, category: "interest" },
    // ── Account B ────────────────────────────────────────────────────────────
    { activityId: 20004001, accountNumber: B, time: daysAgo(1),  description: "SCHWAB PRIME ADVANTAGE MONEY INVESTOR", symbol: null, amount:  58.30, category: "dividend" },
    { activityId: 20004002, accountNumber: B, time: daysAgo(32), description: "SCHWAB PRIME ADVANTAGE MONEY INVESTOR", symbol: null, amount:  55.10, category: "dividend" },
    { activityId: 20004003, accountNumber: B, time: daysAgo(8),  description: "PROSHARES ULTRAPRO QQQ",                symbol: null, amount:   9.80, category: "dividend" },
    { activityId: 20004004, accountNumber: B, time: daysAgo(16), description: "BANK INT 021526-031526 SCHWAB BANK",    symbol: null, amount:   0.08, category: "interest" },
    // ── Account C ────────────────────────────────────────────────────────────
    { activityId: 30004001, accountNumber: C, time: daysAgo(1),  description: "SCHWAB PRIME ADVANTAGE MONEY INVESTOR", symbol: null, amount: 185.60, category: "dividend" },
    { activityId: 30004002, accountNumber: C, time: daysAgo(32), description: "SCHWAB PRIME ADVANTAGE MONEY INVESTOR", symbol: null, amount: 178.20, category: "dividend" },
    { activityId: 30004003, accountNumber: C, time: daysAgo(62), description: "SCHWAB PRIME ADVANTAGE MONEY INVESTOR", symbol: null, amount: 168.40, category: "dividend" },
    { activityId: 30004004, accountNumber: C, time: daysAgo(8),  description: "PROSHARES ULTRAPRO QQQ",                symbol: null, amount:  62.40, category: "dividend" },
    { activityId: 30004005, accountNumber: C, time: daysAgo(38), description: "PROSHARES ULTRAPRO QQQ",                symbol: null, amount:  55.80, category: "dividend" },
    { activityId: 30004006, accountNumber: C, time: daysAgo(16), description: "BANK INT 021526-031526 SCHWAB BANK",    symbol: null, amount:   0.22, category: "interest" },
  ],
};
