import type { SchwabData } from "@/app/api/schwab/data/route";
import type { SchwabAccount } from "@/app/api/schwab/accounts/route";
import type { Account } from "@/lib/context/AppContext";

const ACCOUNT = "123456789";

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
  { accountNumber: ACCOUNT, nickName: "Demo Account" },
];

// ---------------------------------------------------------------------------
// Account settings (returned by /api/settings?key=accounts)
//
// Settings are chosen so computeLevels(200000, 65, 5, 0.97) produces integer
// share counts matching the fills below:
//   Level  0: 99 shares @ $65.00   (sold)
//   Level  1: 97 shares @ $64.35   (sold)
//   Level  2: 95 shares @ $63.70   (sold)
//   Level  3: 93 shares @ $63.05   (sold)
//   Level  4: 91 shares @ $62.40   ← held
//   Level  5: 90 shares @ $61.75   ← held  (current price ~$62 falls here)
//   Level  6: 88 shares @ $61.10   ← held
//   Level  7: 86 shares @ $60.45   ← held
//   Level  8: 84 shares @ $59.80   ← held
//   Level  9: 83 shares @ $59.15   ← held
//   Level 10: 81 shares @ $58.50   ← held
//   Level 11: 80 shares @ $57.85   ← held
//   Level 12: 78 shares @ $57.20   ← held
//   Level 13: 77 shares @ $56.55   working order
//   Level 14: 75 shares @ $55.90   working order
//   Level 15: 74 shares @ $55.25   working order
// ---------------------------------------------------------------------------
export const DEMO_ACCOUNT_CONFIG: Account[] = [
  {
    accountNumber: ACCOUNT,
    accountName: "Demo Account",
    color: "blue",
    settings: {
      startingCash: 200000,
      startingDate: new Date("2026-01-01"),
      initialLotPrice: 65.0,
      sellPercentage: 5,
      reductionFactor: 0.97,
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
// Narrative: account opened ~90 days ago, accumulated levels 0–12 as TQQQ
// drifted from ~$65 down to ~$57, then sold levels 0–3 as price rebounded.
// Currently holds levels 4–12 (761 shares, avg cost $59.88).
// Working buy orders sit at levels 13–15 below current price.
// ---------------------------------------------------------------------------
export const DEMO_DATA: SchwabData = {
  filledOrders: [
    // --- BUY fills: accumulated levels 0–12 as price declined ---
    { orderId: 10000001, accountNumber: ACCOUNT, side: "BUY",  shares: 99, fillPrice: 65.00, total:  6435.00, time: daysAgo(88) },
    { orderId: 10000002, accountNumber: ACCOUNT, side: "BUY",  shares: 97, fillPrice: 64.35, total:  6241.95, time: daysAgo(82) },
    { orderId: 10000003, accountNumber: ACCOUNT, side: "BUY",  shares: 95, fillPrice: 63.70, total:  6051.50, time: daysAgo(76) },
    { orderId: 10000004, accountNumber: ACCOUNT, side: "BUY",  shares: 93, fillPrice: 63.05, total:  5873.65, time: daysAgo(70) },
    { orderId: 10000005, accountNumber: ACCOUNT, side: "BUY",  shares: 91, fillPrice: 62.40, total:  5678.40, time: daysAgo(62) },
    { orderId: 10000006, accountNumber: ACCOUNT, side: "BUY",  shares: 90, fillPrice: 61.75, total:  5557.50, time: daysAgo(55) },
    { orderId: 10000007, accountNumber: ACCOUNT, side: "BUY",  shares: 88, fillPrice: 61.10, total:  5376.80, time: daysAgo(50) },
    { orderId: 10000008, accountNumber: ACCOUNT, side: "BUY",  shares: 86, fillPrice: 60.45, total:  5198.70, time: daysAgo(44) },
    { orderId: 10000009, accountNumber: ACCOUNT, side: "BUY",  shares: 84, fillPrice: 59.80, total:  5023.20, time: daysAgo(38) },
    { orderId: 10000010, accountNumber: ACCOUNT, side: "BUY",  shares: 83, fillPrice: 59.15, total:  4909.45, time: daysAgo(31) },
    { orderId: 10000011, accountNumber: ACCOUNT, side: "BUY",  shares: 81, fillPrice: 58.50, total:  4738.50, time: daysAgo(24) },
    { orderId: 10000012, accountNumber: ACCOUNT, side: "BUY",  shares: 80, fillPrice: 57.85, total:  4628.00, time: daysAgo(17) },
    { orderId: 10000013, accountNumber: ACCOUNT, side: "BUY",  shares: 78, fillPrice: 57.20, total:  4461.60, time: daysAgo(9) },
    // --- SELL fills: took profits on levels 0–3 as price rebounded ---
    { orderId: 10000014, accountNumber: ACCOUNT, side: "SELL", shares: 93, fillPrice: 66.20, total:  6156.60, time: daysAgo(18) },
    { orderId: 10000015, accountNumber: ACCOUNT, side: "SELL", shares: 95, fillPrice: 66.89, total:  6354.55, time: daysAgo(15) },
    { orderId: 10000016, accountNumber: ACCOUNT, side: "SELL", shares: 97, fillPrice: 67.57, total:  6554.29, time: daysAgo(12) },
    { orderId: 10000017, accountNumber: ACCOUNT, side: "SELL", shares: 99, fillPrice: 68.25, total:  6756.75, time: daysAgo(10) },
  ],

  filledOptionOrders: [
    { orderId: 10001001, accountNumber: ACCOUNT, instruction: "SELL_TO_OPEN",  symbol: "TQQQ260417P00055000", contracts: 2, fillPrice: 1.85, total:  370.00, time: daysAgo(28) },
    { orderId: 10001002, accountNumber: ACCOUNT, instruction: "SELL_TO_OPEN",  symbol: "TQQQ260417P00050000", contracts: 3, fillPrice: 0.95, total:  285.00, time: daysAgo(28) },
    { orderId: 10001003, accountNumber: ACCOUNT, instruction: "SELL_TO_OPEN",  symbol: "TQQQ260515P00052000", contracts: 2, fillPrice: 2.10, total:  420.00, time: daysAgo(14) },
    { orderId: 10001004, accountNumber: ACCOUNT, instruction: "SELL_TO_OPEN",  symbol: "TQQQ260417C00075000", contracts: 2, fillPrice: 0.72, total:  144.00, time: daysAgo(28) },
    { orderId: 10001005, accountNumber: ACCOUNT, instruction: "BUY_TO_CLOSE",  symbol: "TQQQ260320P00058000", contracts: 2, fillPrice: 0.05, total:  -10.00, time: daysAgo(11) },
  ],

  expiredOptionOrders: [
    { activityId: 20000001, accountNumber: ACCOUNT, symbol: "TQQQ260320P00058000", contracts: 3, time: daysAgo(11) },
    { activityId: 20000002, accountNumber: ACCOUNT, symbol: "TQQQ260306C00072000", contracts: 1, time: daysAgo(25) },
  ],

  workingOrders: [
    { orderId: 10002001, accountNumber: ACCOUNT, side: "BUY", shares: 77, limitPrice: 56.55, enteredTime: daysAgo(3), status: "WORKING" },
    { orderId: 10002002, accountNumber: ACCOUNT, side: "BUY", shares: 75, limitPrice: 55.90, enteredTime: daysAgo(3), status: "WORKING" },
    { orderId: 10002003, accountNumber: ACCOUNT, side: "BUY", shares: 74, limitPrice: 55.25, enteredTime: daysAgo(3), status: "WORKING" },
  ],

  optionPositions: [
    {
      accountNumber: ACCOUNT,
      symbol: "TQQQ260417P00055000",
      putCall: "PUT",
      strike: 55,
      expiry: "2026-04-17",
      shortQty: 2,
      longQty: 0,
      marketValue: -180.00,
      averagePrice: 1.85,
      openedAt: daysAgo(28),
    },
    {
      accountNumber: ACCOUNT,
      symbol: "TQQQ260417P00050000",
      putCall: "PUT",
      strike: 50,
      expiry: "2026-04-17",
      shortQty: 3,
      longQty: 0,
      marketValue: -114.00,
      averagePrice: 0.95,
      openedAt: daysAgo(28),
    },
    {
      accountNumber: ACCOUNT,
      symbol: "TQQQ260515P00052000",
      putCall: "PUT",
      strike: 52,
      expiry: "2026-05-15",
      shortQty: 2,
      longQty: 0,
      marketValue: -260.00,
      averagePrice: 2.10,
      openedAt: daysAgo(14),
    },
    {
      accountNumber: ACCOUNT,
      symbol: "TQQQ260417C00075000",
      putCall: "CALL",
      strike: 75,
      expiry: "2026-04-17",
      shortQty: 2,
      longQty: 0,
      marketValue: -56.00,
      averagePrice: 0.72,
      openedAt: daysAgo(28),
    },
  ],

  // 761 shares held (levels 4–12), avg cost $59.88
  tqqqShares:   { [ACCOUNT]: 761 },
  tqqqAvgPrice: { [ACCOUNT]: 59.88 },

  balances: [
    {
      accountNumber: ACCOUNT,
      totalValue:              202400.00,
      cash:                      3200.00,
      tqqqValue:                47182.00,   // 761 × ~$62
      moneyMarketValue:        151400.00,   // SWVXX (incl. CSP collateral)
      optionsValue:               610.00,
      otherValue:                   0.00,
      availableFunds:            3200.00,
      cashAvailableForTrading:   3200.00,
    },
  ],

  transactions: [
    { activityId: 30000001, accountNumber: ACCOUNT, time: daysAgo(1),  description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount:  84.32, category: "interest" },
    { activityId: 30000002, accountNumber: ACCOUNT, time: daysAgo(31), description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount:  79.11, category: "interest" },
    { activityId: 30000003, accountNumber: ACCOUNT, time: daysAgo(62), description: "SWVXX DIV REINVEST",     symbol: "SWVXX", amount:  91.48, category: "interest" },
    { activityId: 30000004, accountNumber: ACCOUNT, time: daysAgo(8),  description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:  12.80, category: "dividend" },
    { activityId: 30000005, accountNumber: ACCOUNT, time: daysAgo(38), description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:  11.20, category: "dividend" },
    { activityId: 30000006, accountNumber: ACCOUNT, time: daysAgo(69), description: "TQQQ ORDINARY DIVIDEND", symbol: "TQQQ",  amount:  13.60, category: "dividend" },
  ],
};
