"use client";

import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import type { FilledOrder, FilledOptionOrder, ExpiredOptionOrder, WorkingOrder, OptionPosition } from "@/lib/schwab/parse";
import type { Transaction, AccountBalance } from "@/app/api/schwab/data/route";
export type { FilledOrder, FilledOptionOrder, ExpiredOptionOrder, WorkingOrder, OptionPosition, Transaction, AccountBalance };

export interface AccountSettings {
  initialCash: number | null;
  levelStartingCash: number | null;
  startingDate: Date | null;
  initialLotPrice: number | null;
  sellPercentage: number | null;
  reductionFactor: number | null;
  orderWarnBelow: number | null;
  orderBuffer: number | null;
  callSafetyLevels: number | null;
  putSafetyLevels: number | null;
  levelResetDate: Date | null;
}

export interface Account {
  accountNumber: string;
  accountName: string;
  color: string;
  broker?: "schwab" | "tastytrade";
  settings: AccountSettings;
}

const DEFAULT_SETTINGS: AccountSettings = {
  initialCash: null,
  levelStartingCash: null,
  startingDate: null,
  initialLotPrice: null,
  sellPercentage: null,
  reductionFactor: null,
  orderWarnBelow: 3,
  orderBuffer: 5,
  callSafetyLevels: 8,
  putSafetyLevels: 8,
  levelResetDate: null,
};

export interface Quote {
  price: number;
  changePercent: number;
  /** 1 = 3 consecutive up days, -1 = 3 consecutive down days, 0 = mixed/unknown */
  trend: number;
  /** Last ~30 trading day closing prices */
  closes30: number[];
  /** Dates for closes30, formatted as "M/D" */
  dates30: string[];
  /** Day of week (0=Sun…6=Sat) for each closes30 entry */
  daysOfWeek30: number[];
  loading: boolean;
}

export interface Alerts {
  levelMatch: boolean | null;
  workingOrders: boolean | null;
  duplicateOrders: number | null;
  expiringOptions: number | null;
  itmOptions: number | null;
  idleCash: number | null;
}

interface AppContextValue {
  accounts: Account[];
  setAccounts: (accounts: Account[]) => void;
  activeAccount: Account | null;
  setActiveAccount: (account: Account | null) => void;
  updateAccountColor: (accountNumber: string, color: string) => void;
  updateAccountSettings: (accountNumber: string, settings: Partial<AccountSettings>) => void;
  privacyMode: boolean;
  togglePrivacy: () => void;
  lastRefreshed: Date | null;
  setLastRefreshed: (date: Date) => void;
  quote: Quote;
  setQuote: React.Dispatch<React.SetStateAction<Quote>>;
  refreshTick: number;
  tickRefresh: () => void;
  quoteTick: number;
  tickQuoteRefresh: () => void;
  alerts: Alerts;
  setAlerts: React.Dispatch<React.SetStateAction<Alerts>>;
  schwabConnected: boolean | null; // null = loading
  checkSchwabAuth: () => Promise<void>;
  tastytradeConnected: boolean | null; // null = loading
  checkTastytradeAuth: () => Promise<void>;
  filledOrders: FilledOrder[];
  filledOptionOrders: FilledOptionOrder[];
  expiredOptionOrders: ExpiredOptionOrder[];
  workingOrders: WorkingOrder[];
  optionPositions: OptionPosition[];
  transactions: Transaction[];
  tqqqShares: number;
  tqqqAvgPrice: number;
  allTqqqShares: Record<string, number>;
  allTqqqAvgPrice: Record<string, number>;
  allFilledOrders: FilledOrder[];
  allWorkingOrders: WorkingOrder[];
  allOptionPositions: OptionPosition[];
  snapshotLoading: boolean;
  balances: AccountBalance[];
  balancesLoading: boolean;
}

const ACTIVE_ACCOUNT_KEY = "tqqq-active-account";

const DEFAULT_ACCOUNTS: Account[] = [];

export function deserializeAccount(a: Account): Account {
  const raw = a.settings as unknown as Record<string, unknown>;
  return {
    ...a,
    settings: {
      ...a.settings,
      // Migrate old field name → new field name
      levelStartingCash: a.settings.levelStartingCash ?? (raw.startingCash as number | null) ?? null,
      startingDate: a.settings.startingDate ? new Date(a.settings.startingDate) : null,
      levelResetDate: a.settings.levelResetDate ? new Date(a.settings.levelResetDate) : null,
    },
  };
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // Start with empty defaults (matches SSR); init effect loads from Supabase before enabling writes
  const [accounts, setAccounts] = useState<Account[]>(DEFAULT_ACCOUNTS);
  const [activeAccount, setActiveAccount] = useState<Account | null>(DEFAULT_ACCOUNTS[0] ?? null);
  // initialized becomes true after settings are loaded from the database — persists only fire after this
  const [initialized, setInitialized] = useState(false);

  // Persist accounts to Supabase whenever they change (after initial load)
  useEffect(() => {
    if (!initialized) return;
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "accounts", value: accounts }),
    }).catch(() => {});
  }, [initialized, accounts]);

  // Persist active account selection
  useEffect(() => {
    if (!initialized) return;
    if (activeAccount) localStorage.setItem(ACTIVE_ACCOUNT_KEY, activeAccount.accountNumber);
  }, [initialized, activeAccount]);

  const [privacyMode, setPrivacyMode] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [schwabConnected, setSchwabConnected] = useState<boolean | null>(null);
  const [tastytradeConnected, setTastytradeConnected] = useState<boolean | null>(null);

  const syncAccountsFromSchwab = async () => {
    try {
      const res = await fetch("/api/schwab/accounts");
      const schwabAccounts = await res.json();
      if (!Array.isArray(schwabAccounts)) return;

      setAccounts((prev) => {
        const colors = ["blue", "teal", "violet", "orange", "pink", "grape"];
        const nonSchwab = prev.filter((a) => a.broker === "tastytrade"); // undefined = legacy schwab, exclude
        const merged = schwabAccounts.map((sa: { accountNumber: string; nickName: string }, i: number) => {
          const existing = prev.find((a) => a.accountNumber === sa.accountNumber);
          return existing
            ? { ...existing, accountName: sa.nickName, broker: "schwab" as const }
            : {
                accountNumber: sa.accountNumber,
                accountName: sa.nickName,
                color: colors[i % colors.length],
                broker: "schwab" as const,
                settings: { ...DEFAULT_SETTINGS },
              };
        });
        const allAccounts = [...merged, ...nonSchwab];
        setActiveAccount((active) => {
          const savedNumber = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
          const preferred = savedNumber ?? active?.accountNumber;
          return allAccounts.find((a) => a.accountNumber === preferred) ?? allAccounts[0] ?? null;
        });
        return allAccounts;
      });
    } catch {
      // silently ignore — accounts remain as-is
    }
  };

  const syncAccountsFromTastytrade = async () => {
    try {
      const res = await fetch("/api/tastytrade/accounts");
      if (!res.ok) return;
      const tastyAccounts = await res.json();
      if (!Array.isArray(tastyAccounts)) return;

      setAccounts((prev) => {
        const colors = ["blue", "teal", "violet", "orange", "pink", "grape"];
        const nonTasty = prev.filter((a) => a.broker !== "tastytrade"); // keep schwab + legacy (undefined)
        const merged = tastyAccounts.map((ta: { accountNumber: string; nickName: string }, i: number) => {
          const existing = prev.find((a) => a.accountNumber === ta.accountNumber);
          const colorIdx = nonTasty.length + i;
          return existing
            ? { ...existing, accountName: ta.nickName, broker: "tastytrade" as const }
            : {
                accountNumber: ta.accountNumber,
                accountName: ta.nickName,
                color: colors[colorIdx % colors.length],
                broker: "tastytrade" as const,
                settings: { ...DEFAULT_SETTINGS },
              };
        });
        return [...nonTasty, ...merged];
      });
    } catch {
      // silently ignore
    }
  };

  const checkTastytradeAuth = async () => {
    try {
      const res = await fetch("/api/tastytrade/auth");
      const data = await res.json();
      const connected = data.connected === true;
      setTastytradeConnected(connected);
      if (connected) await syncAccountsFromTastytrade();
    } catch {
      setTastytradeConnected(false);
    }
  };

  const checkSchwabAuth = async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      const connected = data.authenticated === true;
      setSchwabConnected(connected);
      await checkTastytradeAuth();
      if (connected) await syncAccountsFromSchwab();
    } catch {
      setSchwabConnected(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function init() {
      // 1. Load accounts from Supabase (source of truth)
      let remoteAccounts: Account[] = [];
      try {
        const data = await fetch("/api/settings?key=accounts").then((r) => r.json());
        if (!cancelled && data.value) {
          remoteAccounts = (data.value as Account[]).map(deserializeAccount);
          setAccounts(remoteAccounts);
        }
      } catch {}

      if (cancelled) return;

      // 2. Check both auth statuses in parallel — faster startup, no sequential blocking
      try {
        const [schwabRes, tastyRes] = await Promise.allSettled([
          fetch("/api/auth/status").then((r) => r.json()),
          fetch("/api/tastytrade/auth").then((r) => r.json()),
        ]);
        if (cancelled) return;

        const connected = schwabRes.status === "fulfilled" && schwabRes.value?.authenticated === true;
        const tastyConnected = tastyRes.status === "fulfilled" && tastyRes.value?.connected === true;
        setSchwabConnected(connected);
        setTastytradeConnected(tastyConnected);

        if (tastyConnected) await syncAccountsFromTastytrade();
        if (cancelled) return;
        if (connected) {
          await syncAccountsFromSchwab(); // sets activeAccount internally
        } else {
          const savedNumber = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
          setActiveAccount(
            (savedNumber ? remoteAccounts.find((a) => a.accountNumber === savedNumber) : null) ??
              remoteAccounts[0] ??
              null
          );
        }
      } catch {
        if (!cancelled) {
          setSchwabConnected(false);
          setTastytradeConnected(false);
          const savedNumber = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
          setActiveAccount(
            (savedNumber ? remoteAccounts.find((a) => a.accountNumber === savedNumber) : null) ??
              remoteAccounts[0] ??
              null
          );
        }
      }

      // 3. Enable persistence writes now that initial load is complete
      if (!cancelled) setInitialized(true);
    }
    init();
    return () => { cancelled = true; };
  }, []);
  const [quote, setQuote] = useState<Quote>({ price: 0, changePercent: 0, trend: 0, closes30: [], dates30: [], daysOfWeek30: [], loading: true });
  const [refreshTick, setRefreshTick] = useState(0);
  const [quoteTick, setQuoteTick] = useState(0);
  const [allFilledOrders, setAllFilledOrders] = useState<FilledOrder[]>([]);
  const [allFilledOptionOrders, setAllFilledOptionOrders] = useState<FilledOptionOrder[]>([]);
  const [allExpiredOptionOrders, setAllExpiredOptionOrders] = useState<ExpiredOptionOrder[]>([]);
  const [allWorkingOrders, setAllWorkingOrders] = useState<WorkingOrder[]>([]);
  const [allOptionPositions, setAllOptionPositions] = useState<OptionPosition[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [allTqqqShares, setAllTqqqShares] = useState<Record<string, number>>({});
  const [allTqqqAvgPrice, setAllTqqqAvgPrice] = useState<Record<string, number>>({});
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [allBalances, setAllBalances] = useState<AccountBalance[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setSnapshotLoading(true);
      try {
        const [schwabResult, tastyResult] = await Promise.allSettled([
          fetch("/api/schwab/data").then((r) => r.json()),
          fetch("/api/tastytrade/data").then((r) => (r.ok ? r.json() : null)),
        ]);
        if (cancelled) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s: any = schwabResult.status === "fulfilled" ? schwabResult.value : null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t: any = tastyResult.status === "fulfilled" ? tastyResult.value : null;

        function mergeByTime<T>(a: T[] = [], b: T[] = [], key: keyof T): T[] {
          return [...a, ...b].sort(
            (x, y) =>
              new Date(y[key] as string).getTime() - new Date(x[key] as string).getTime(),
          );
        }

        // Identify tastytrade accounts so we can preserve each broker's data on failure
        const tastyNums = new Set(
          accounts.filter(a => a.broker === "tastytrade").map(a => a.accountNumber)
        );
        const sOk = Array.isArray(s?.filledOrders);
        const tOk = Array.isArray(t?.filledOrders);

        // If tastytrade data failed, re-check auth so the TT button reflects disconnected state
        if (tastyResult.status === "fulfilled" && tastyResult.value === null) {
          checkTastytradeAuth();
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function safeSetOrders<T extends { accountNumber: string }>(
          setter: React.Dispatch<React.SetStateAction<T[]>>,
          sData: T[] | undefined,
          tData: T[] | undefined,
          key: keyof T,
        ) {
          setter(prev => {
            const prevSchwab = prev.filter(o => !tastyNums.has(o.accountNumber));
            const prevTasty = prev.filter(o => tastyNums.has(o.accountNumber));
            return mergeByTime(
              Array.isArray(sData) ? sData : prevSchwab,
              Array.isArray(tData) ? tData : prevTasty,
              key,
            );
          });
        }

        safeSetOrders(setAllFilledOrders, s?.filledOrders, t?.filledOrders, "time" as never);
        safeSetOrders(setAllFilledOptionOrders, s?.filledOptionOrders, t?.filledOptionOrders, "time" as never);
        safeSetOrders(setAllExpiredOptionOrders, s?.expiredOptionOrders, t?.expiredOptionOrders, "time" as never);
        safeSetOrders(setAllWorkingOrders, s?.workingOrders, t?.workingOrders, "enteredTime" as never);

        if (sOk || tOk) {
          setAllOptionPositions(prev => [
            ...(sOk ? (s?.optionPositions ?? []) : prev.filter(p => !tastyNums.has(p.accountNumber))),
            ...(tOk ? (t?.optionPositions ?? []) : prev.filter(p => tastyNums.has(p.accountNumber))),
          ]);
          setAllTqqqShares(prev => ({ ...prev, ...(s?.tqqqShares ?? {}), ...(t?.tqqqShares ?? {}) }));
          setAllTqqqAvgPrice(prev => ({ ...prev, ...(s?.tqqqAvgPrice ?? {}), ...(t?.tqqqAvgPrice ?? {}) }));
          setAllBalances(prev => [
            ...(sOk ? (s?.balances ?? []) : prev.filter(b => !tastyNums.has(b.accountNumber))),
            ...(tOk ? (t?.balances ?? []) : prev.filter(b => tastyNums.has(b.accountNumber))),
          ]);
          safeSetOrders(setAllTransactions, s?.transactions, t?.transactions, "time" as never);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshTick]);

  const accountNumber = activeAccount?.accountNumber ?? null;
  const filledOrders = useMemo(
    () => accountNumber ? allFilledOrders.filter((o) => o.accountNumber === accountNumber) : [],
    [allFilledOrders, accountNumber]
  );
  const workingOrders = useMemo(
    () => accountNumber ? allWorkingOrders.filter((o) => o.accountNumber === accountNumber) : [],
    [allWorkingOrders, accountNumber]
  );
  const optionPositions = useMemo(
    () => accountNumber ? allOptionPositions.filter((o) => o.accountNumber === accountNumber) : [],
    [allOptionPositions, accountNumber]
  );
  const filledOptionOrders = useMemo(
    () => accountNumber ? allFilledOptionOrders.filter((o) => o.accountNumber === accountNumber) : [],
    [allFilledOptionOrders, accountNumber]
  );
  const expiredOptionOrders = useMemo(
    () => accountNumber ? allExpiredOptionOrders.filter((o) => o.accountNumber === accountNumber) : [],
    [allExpiredOptionOrders, accountNumber]
  );
  const transactions = useMemo(
    () => accountNumber ? allTransactions.filter((t) => t.accountNumber === accountNumber) : [],
    [allTransactions, accountNumber]
  );
  const tqqqShares = useMemo(
    () => accountNumber ? (allTqqqShares[accountNumber] ?? 0) : 0,
    [allTqqqShares, accountNumber]
  );
  const tqqqAvgPrice = useMemo(
    () => accountNumber ? (allTqqqAvgPrice[accountNumber] ?? 0) : 0,
    [allTqqqAvgPrice, accountNumber]
  );
  const [alerts, setAlerts] = useState<Alerts>({
    levelMatch: null,
    workingOrders: null,
    duplicateOrders: null,
    expiringOptions: null,
    itmOptions: null,
    idleCash: null,
  });

  const updateAccountColor = (accountNumber: string, color: string) => {
    setAccounts((prev) =>
      prev.map((a) => (a.accountNumber === accountNumber ? { ...a, color } : a))
    );
    setActiveAccount((prev) =>
      prev?.accountNumber === accountNumber ? { ...prev, color } : prev
    );
  };

  const updateAccountSettings = (accountNumber: string, settings: Partial<AccountSettings>) => {
    setAccounts((prev) =>
      prev.map((a) =>
        a.accountNumber === accountNumber
          ? { ...a, settings: { ...a.settings, ...settings } }
          : a
      )
    );
    setActiveAccount((prev) =>
      prev?.accountNumber === accountNumber
        ? { ...prev, settings: { ...prev.settings, ...settings } }
        : prev
    );
  };

const togglePrivacy = () => setPrivacyMode((p) => !p);
  const tickRefresh = () => {
    setQuote((q) => ({ ...q, loading: true }));
    setRefreshTick((t) => t + 1);
  };
  const tickQuoteRefresh = () => {
    setQuote((q) => ({ ...q, loading: true }));
    setQuoteTick((t) => t + 1);
  };

  return (
    <AppContext.Provider
      value={{
        accounts,
        setAccounts,
        activeAccount,
        setActiveAccount,
        updateAccountColor,
        updateAccountSettings,
        privacyMode,
        togglePrivacy,
        lastRefreshed,
        setLastRefreshed,
        quote,
        setQuote,
        refreshTick,
        tickRefresh,
        quoteTick,
        tickQuoteRefresh,
        alerts,
        setAlerts,
        schwabConnected,
        checkSchwabAuth,
        tastytradeConnected,
        checkTastytradeAuth,
        filledOrders,
        filledOptionOrders,
        expiredOptionOrders,
        workingOrders,
        optionPositions,
        transactions,
        tqqqShares,
        tqqqAvgPrice,
        allTqqqShares,
        allTqqqAvgPrice,
        allFilledOrders,
        allWorkingOrders,
        allOptionPositions,
        snapshotLoading,
        balances: allBalances,
        balancesLoading: snapshotLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
