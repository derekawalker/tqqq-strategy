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
// All three: initialLotPrice=65, sellPercentage=1.64, reductionFactor=0.95
// Share counts per level verified against computeLevels():
//
//  Account A ($200k): L0=156 L1=149 L2=143 L3=137 L4=132 L5=127 L6=122 ...
//  Account B ($100k): L0=78  L1=75  L2=72  L3=69  L4=66  L5=63  L6=61  ...
//  Account C ($300k): L0=233 L1=224 L2=215 L3=206 L4=198 L5=190 L6=182 ...
// ---------------------------------------------------------------------------
export const DEMO_ACCOUNT_CONFIG: Account[] = [
  {
    accountNumber: A,
    accountName: "Main Account",
    color: "blue",
    settings: {
      startingCash: 200000,
      startingDate: new Date("2026-01-01"),
      initialLotPrice: 65.0,
      sellPercentage: 1.64,
      reductionFactor: 0.95,
      orderWarnBelow: 3,
      orderBuffer: 5,
      callSafetyLevels: 6,
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
      initialLotPrice: 65.0,
      sellPercentage: 1.64,
      reductionFactor: 0.95,
      orderWarnBelow: 3,
      orderBuffer: 5,
      callSafetyLevels: 6,
      putSafetyLevels: 8,
    },
  },
  {
    accountNumber: C,
    accountName: "Joint",
    color: "violet",
    settings: {
      startingCash: 300000,
      startingDate: new Date("2025-12-01"),
      initialLotPrice: 65.0,
      sellPercentage: 1.64,
      reductionFactor: 0.95,
      orderWarnBelow: 3,
      orderBuffer: 5,
      callSafetyLevels: 6,
      putSafetyLevels: 8,
    },
  },
];

// ---------------------------------------------------------------------------
// Trading data (returned by /api/schwab/data)
//
// Account A ($200k) — mid-strategy: levels 4–12 held, 0–3 sold, 3 working orders
// Account B ($100k) — newer/smaller: levels 0–5 held, 3 working orders, no options
// Account C ($300k) — larger/deeper: levels 3–14 held, 0–2 sold, 3 working orders
// ---------------------------------------------------------------------------
export const DEMO_DATA: SchwabData = {
  filledOrders: [
    // ── Account A ────────────────────────────────────────────────────────────
    // BUY: accumulated levels 0–12 as price declined
    { orderId: 10000001, accountNumber: A, side: "BUY",  shares: 156, fillPrice: 65.00, total: 10140.00, time: daysAgo(88) },
    { orderId: 10000002, accountNumber: A, side: "BUY",  shares: 149, fillPrice: 64.35, total:  9588.15, time: daysAgo(82) },
    { orderId: 10000003, accountNumber: A, side: "BUY",  shares: 143, fillPrice: 63.70, total:  9109.10, time: daysAgo(76) },
    { orderId: 10000004, accountNumber: A, side: "BUY",  shares: 137, fillPrice: 63.05, total:  8637.85, time: daysAgo(70) },
    { orderId: 10000005, accountNumber: A, side: "BUY",  shares: 132, fillPrice: 62.40, total:  8236.80, time: daysAgo(62) },
    { orderId: 10000006, accountNumber: A, side: "BUY",  shares: 127, fillPrice: 61.75, total:  7842.25, time: daysAgo(55) },
    { orderId: 10000007, accountNumber: A, side: "BUY",  shares: 122, fillPrice: 61.10, total:  7454.20, time: daysAgo(50) },
    { orderId: 10000008, accountNumber: A, side: "BUY",  shares: 117, fillPrice: 60.45, total:  7072.65, time: daysAgo(44) },
    { orderId: 10000009, accountNumber: A, side: "BUY",  shares: 112, fillPrice: 59.80, total:  6697.60, time: daysAgo(38) },
    { orderId: 10000010, accountNumber: A, side: "BUY",  shares: 108, fillPrice: 59.15, total:  6388.20, time: daysAgo(31) },
    { orderId: 10000011, accountNumber: A, side: "BUY",  shares: 103, fillPrice: 58.50, total:  6025.50, time: daysAgo(24) },
    { orderId: 10000012, accountNumber: A, side: "BUY",  shares:  99, fillPrice: 57.85, total:  5727.15, time: daysAgo(17) },
    { orderId: 10000013, accountNumber: A, side: "BUY",  shares:  96, fillPrice: 57.20, total:  5491.20, time: daysAgo(9) },
    // SELL: took profits on levels 0–3 as price rebounded
    { orderId: 10000014, accountNumber: A, side: "SELL", shares: 137, fillPrice: 64.08, total:  8778.96, time: daysAgo(18) },
    { orderId: 10000015, accountNumber: A, side: "SELL", shares: 143, fillPrice: 64.74, total:  9257.82, time: daysAgo(15) },
    { orderId: 10000016, accountNumber: A, side: "SELL", shares: 149, fillPrice: 65.41, total:  9746.09, time: daysAgo(12) },
    { orderId: 10000017, accountNumber: A, side: "SELL", shares: 156, fillPrice: 66.07, total: 10306.92, time: daysAgo(10) },

    // ── Account B ────────────────────────────────────────────────────────────
    // BUY: accumulating levels 0–5, still holding all of them
    { orderId: 20000001, accountNumber: B, side: "BUY",  shares:  78, fillPrice: 65.00, total:  5070.00, time: daysAgo(59) },
    { orderId: 20000002, accountNumber: B, side: "BUY",  shares:  75, fillPrice: 64.35, total:  4826.25, time: daysAgo(53) },
    { orderId: 20000003, accountNumber: B, side: "BUY",  shares:  72, fillPrice: 63.70, total:  4586.40, time: daysAgo(47) },
    { orderId: 20000004, accountNumber: B, side: "BUY",  shares:  69, fillPrice: 63.05, total:  4350.45, time: daysAgo(41) },
    { orderId: 20000005, accountNumber: B, side: "BUY",  shares:  66, fillPrice: 62.40, total:  4118.40, time: daysAgo(35) },
    { orderId: 20000006, accountNumber: B, side: "BUY",  shares:  63, fillPrice: 61.75, total:  3890.25, time: daysAgo(28) },

    // ── Account C ────────────────────────────────────────────────────────────
    // BUY: accumulated levels 0–14 as price declined
    { orderId: 30000001, accountNumber: C, side: "BUY",  shares: 233, fillPrice: 65.00, total: 15145.00, time: daysAgo(88) },
    { orderId: 30000002, accountNumber: C, side: "BUY",  shares: 224, fillPrice: 64.35, total: 14414.40, time: daysAgo(83) },
    { orderId: 30000003, accountNumber: C, side: "BUY",  shares: 215, fillPrice: 63.70, total: 13695.50, time: daysAgo(78) },
    { orderId: 30000004, accountNumber: C, side: "BUY",  shares: 206, fillPrice: 63.05, total: 12988.30, time: daysAgo(72) },
    { orderId: 30000005, accountNumber: C, side: "BUY",  shares: 198, fillPrice: 62.40, total: 12355.20, time: daysAgo(66) },
    { orderId: 30000006, accountNumber: C, side: "BUY",  shares: 190, fillPrice: 61.75, total: 11732.50, time: daysAgo(60) },
    { orderId: 30000007, accountNumber: C, side: "BUY",  shares: 182, fillPrice: 61.10, total: 11120.20, time: daysAgo(54) },
    { orderId: 30000008, accountNumber: C, side: "BUY",  shares: 175, fillPrice: 60.45, total: 10578.75, time: daysAgo(48) },
    { orderId: 30000009, accountNumber: C, side: "BUY",  shares: 168, fillPrice: 59.80, total: 10046.40, time: daysAgo(42) },
    { orderId: 30000010, accountNumber: C, side: "BUY",  shares: 162, fillPrice: 59.15, total:  9582.30, time: daysAgo(35) },
    { orderId: 30000011, accountNumber: C, side: "BUY",  shares: 155, fillPrice: 58.50, total:  9067.50, time: daysAgo(28) },
    { orderId: 30000012, accountNumber: C, side: "BUY",  shares: 149, fillPrice: 57.85, total:  8619.65, time: daysAgo(21) },
    { orderId: 30000013, accountNumber: C, side: "BUY",  shares: 143, fillPrice: 57.20, total:  8179.60, time: daysAgo(14) },
    { orderId: 30000014, accountNumber: C, side: "BUY",  shares: 138, fillPrice: 56.55, total:  7803.90, time: daysAgo(7) },
    { orderId: 30000015, accountNumber: C, side: "BUY",  shares: 132, fillPrice: 55.90, total:  7378.80, time: daysAgo(3) },
    // SELL: took profits on levels 0–2
    { orderId: 30000016, accountNumber: C, side: "SELL", shares: 215, fillPrice: 64.74, total: 13919.10, time: daysAgo(19) },
    { orderId: 30000017, accountNumber: C, side: "SELL", shares: 224, fillPrice: 65.41, total: 14651.84, time: daysAgo(16) },
    { orderId: 30000018, accountNumber: C, side: "SELL", shares: 233, fillPrice: 66.07, total: 15394.31, time: daysAgo(13) },
  ],

  filledOptionOrders: [
    // ── Account A ────────────────────────────────────────────────────────────
    { orderId: 10001001, accountNumber: A, instruction: "SELL_TO_OPEN", symbol: "TQQQ260417P00055000", contracts: 2, fillPrice: 1.85, total:  370.00, time: daysAgo(28) },
    { orderId: 10001002, accountNumber: A, instruction: "SELL_TO_OPEN", symbol: "TQQQ260417P00050000", contracts: 3, fillPrice: 0.95, total:  285.00, time: daysAgo(28) },
    { orderId: 10001003, accountNumber: A, instruction: "SELL_TO_OPEN", symbol: "TQQQ260515P00052000", contracts: 2, fillPrice: 2.10, total:  420.00, time: daysAgo(14) },
    { orderId: 10001004, accountNumber: A, instruction: "SELL_TO_OPEN", symbol: "TQQQ260417C00075000", contracts: 2, fillPrice: 0.72, total:  144.00, time: daysAgo(28) },
    { orderId: 10001005, accountNumber: A, instruction: "BUY_TO_CLOSE", symbol: "TQQQ260320P00058000", contracts: 2, fillPrice: 0.05, total:  -10.00, time: daysAgo(11) },
    // ── Account C ────────────────────────────────────────────────────────────
    { orderId: 30001001, accountNumber: C, instruction: "SELL_TO_OPEN", symbol: "TQQQ260417P00050000", contracts: 5, fillPrice: 0.95, total:  475.00, time: daysAgo(28) },
    { orderId: 30001002, accountNumber: C, instruction: "SELL_TO_OPEN", symbol: "TQQQ260515P00048000", contracts: 4, fillPrice: 1.45, total:  580.00, time: daysAgo(14) },
    { orderId: 30001003, accountNumber: C, instruction: "SELL_TO_OPEN", symbol: "TQQQ260417C00078000", contracts: 3, fillPrice: 0.55, total:  165.00, time: daysAgo(28) },
  ],

  expiredOptionOrders: [
    // ── Account A ────────────────────────────────────────────────────────────
    { activityId: 10002001, accountNumber: A, symbol: "TQQQ260320P00058000", contracts: 3, time: daysAgo(11) },
    { activityId: 10002002, accountNumber: A, symbol: "TQQQ260306C00072000", contracts: 1, time: daysAgo(25) },
    // ── Account C ────────────────────────────────────────────────────────────
    { activityId: 30002001, accountNumber: C, symbol: "TQQQ260306P00055000", contracts: 4, time: daysAgo(25) },
  ],

  workingOrders: [
    // ── Account A ────────────────────────────────────────────────────────────
    { orderId: 10003001, accountNumber: A, side: "BUY", shares:  92, limitPrice: 56.55, enteredTime: daysAgo(3), status: "WORKING" },
    { orderId: 10003002, accountNumber: A, side: "BUY", shares:  88, limitPrice: 55.90, enteredTime: daysAgo(3), status: "WORKING" },
    { orderId: 10003003, accountNumber: A, side: "BUY", shares:  85, limitPrice: 55.25, enteredTime: daysAgo(3), status: "WORKING" },
    // ── Account B ────────────────────────────────────────────────────────────
    { orderId: 20003001, accountNumber: B, side: "BUY", shares:  61, limitPrice: 61.10, enteredTime: daysAgo(2), status: "WORKING" },
    { orderId: 20003002, accountNumber: B, side: "BUY", shares:  58, limitPrice: 60.45, enteredTime: daysAgo(2), status: "WORKING" },
    { orderId: 20003003, accountNumber: B, side: "BUY", shares:  56, limitPrice: 59.80, enteredTime: daysAgo(2), status: "WORKING" },
    // ── Account C ────────────────────────────────────────────────────────────
    { orderId: 30003001, accountNumber: C, side: "BUY", shares: 127, limitPrice: 55.25, enteredTime: daysAgo(3), status: "WORKING" },
    { orderId: 30003002, accountNumber: C, side: "BUY", shares: 122, limitPrice: 54.60, enteredTime: daysAgo(3), status: "WORKING" },
    { orderId: 30003003, accountNumber: C, side: "BUY", shares: 118, limitPrice: 53.95, enteredTime: daysAgo(3), status: "WORKING" },
  ],

  optionPositions: [
    // ── Account A ────────────────────────────────────────────────────────────
    { accountNumber: A, symbol: "TQQQ260417P00055000", putCall: "PUT",  strike: 55, expiry: "2026-04-17", shortQty: 2, longQty: 0, marketValue: -180.00, averagePrice: 1.85, openedAt: daysAgo(28) },
    { accountNumber: A, symbol: "TQQQ260417P00050000", putCall: "PUT",  strike: 50, expiry: "2026-04-17", shortQty: 3, longQty: 0, marketValue: -114.00, averagePrice: 0.95, openedAt: daysAgo(28) },
    { accountNumber: A, symbol: "TQQQ260515P00052000", putCall: "PUT",  strike: 52, expiry: "2026-05-15", shortQty: 2, longQty: 0, marketValue: -260.00, averagePrice: 2.10, openedAt: daysAgo(14) },
    { accountNumber: A, symbol: "TQQQ260417C00075000", putCall: "CALL", strike: 75, expiry: "2026-04-17", shortQty: 2, longQty: 0, marketValue:  -56.00, averagePrice: 0.72, openedAt: daysAgo(28) },
    // ── Account C ────────────────────────────────────────────────────────────
    { accountNumber: C, symbol: "TQQQ260417P00050000", putCall: "PUT",  strike: 50, expiry: "2026-04-17", shortQty: 5, longQty: 0, marketValue: -190.00, averagePrice: 0.95, openedAt: daysAgo(28) },
    { accountNumber: C, symbol: "TQQQ260515P00048000", putCall: "PUT",  strike: 48, expiry: "2026-05-15", shortQty: 4, longQty: 0, marketValue: -240.00, averagePrice: 1.45, openedAt: daysAgo(14) },
    { accountNumber: C, symbol: "TQQQ260417C00078000", putCall: "CALL", strike: 78, expiry: "2026-04-17", shortQty: 3, longQty: 0, marketValue:  -66.00, averagePrice: 0.55, openedAt: daysAgo(28) },
  ],

  tqqqShares: {
    [A]: 1098,  // levels 4–12: 132+127+122+117+112+108+103+99+96 + held rounding
    [B]:  423,  // levels 0–5: 78+75+72+69+66+63
    [C]: 2274,  // levels 3–14: 206+198+190+182+175+168+162+155+149+143+138+132 + held
  },
  tqqqAvgPrice: {
    [A]: 60.12,
    [B]: 63.39,
    [C]: 59.20,
  },

  balances: [
    {
      accountNumber: A,
      totalValue:             204500.00,
      cash:                     3200.00,
      tqqqValue:               68076.00,  // 1098 × ~$62
      moneyMarketValue:        132600.00,
      optionsValue:               610.00,
      otherValue:                   0.00,
      availableFunds:            3200.00,
      cashAvailableForTrading:   3200.00,
    },
    {
      accountNumber: B,
      totalValue:             101800.00,
      cash:                     3600.00,
      tqqqValue:               26226.00,  // 423 × ~$62
      moneyMarketValue:         71900.00,
      optionsValue:                 0.00,
      otherValue:                   0.00,
      availableFunds:            3600.00,
      cashAvailableForTrading:   3600.00,
    },
    {
      accountNumber: C,
      totalValue:             312000.00,
      cash:                     5200.00,
      tqqqValue:              140988.00,  // 2274 × ~$62
      moneyMarketValue:        165300.00,
      optionsValue:               496.00,
      otherValue:                   0.00,
      availableFunds:            5200.00,
      cashAvailableForTrading:   5200.00,
    },
  ],

  transactions: [
    // ── Account A ────────────────────────────────────────────────────────────
    { activityId: 10004001, accountNumber: A, time: daysAgo(1),  description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount:  84.32, category: "interest" },
    { activityId: 10004002, accountNumber: A, time: daysAgo(31), description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount:  79.11, category: "interest" },
    { activityId: 10004003, accountNumber: A, time: daysAgo(62), description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount:  91.48, category: "interest" },
    { activityId: 10004004, accountNumber: A, time: daysAgo(8),  description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:  12.80, category: "dividend" },
    { activityId: 10004005, accountNumber: A, time: daysAgo(38), description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:  11.20, category: "dividend" },
    { activityId: 10004006, accountNumber: A, time: daysAgo(69), description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:  13.60, category: "dividend" },
    // ── Account B ────────────────────────────────────────────────────────────
    { activityId: 20004001, accountNumber: B, time: daysAgo(1),  description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount:  42.18, category: "interest" },
    { activityId: 20004002, accountNumber: B, time: daysAgo(31), description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount:  39.54, category: "interest" },
    { activityId: 20004003, accountNumber: B, time: daysAgo(8),  description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:   5.70, category: "dividend" },
    { activityId: 20004004, accountNumber: B, time: daysAgo(38), description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:   4.90, category: "dividend" },
    // ── Account C ────────────────────────────────────────────────────────────
    { activityId: 30004001, accountNumber: C, time: daysAgo(1),  description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount: 126.44, category: "interest" },
    { activityId: 30004002, accountNumber: C, time: daysAgo(31), description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount: 118.67, category: "interest" },
    { activityId: 30004003, accountNumber: C, time: daysAgo(62), description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount: 137.22, category: "interest" },
    { activityId: 30004004, accountNumber: C, time: daysAgo(8),  description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:  30.18, category: "dividend" },
    { activityId: 30004005, accountNumber: C, time: daysAgo(38), description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:  27.40, category: "dividend" },
    { activityId: 30004006, accountNumber: C, time: daysAgo(69), description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:  33.80, category: "dividend" },
  ],
};
