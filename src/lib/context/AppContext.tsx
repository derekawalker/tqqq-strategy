"use client";

import { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from "react";
import type { FilledOrder, FilledOptionOrder, ExpiredOptionOrder, WorkingOrder, OptionPosition } from "@/lib/schwab/parse";
import type { Transaction, AccountBalance } from "@/app/api/schwab/data/route";
export type { FilledOrder, FilledOptionOrder, ExpiredOptionOrder, WorkingOrder, OptionPosition, Transaction, AccountBalance };

export interface AccountSettings {
  startingCash: number | null;
  startingDate: Date | null;
  initialLotPrice: number | null;
  sellPercentage: number | null;
  reductionFactor: number | null;
  orderWarnBelow: number | null;
  orderBuffer: number | null;
  callSafetyLevels: number | null;
  putSafetyLevels: number | null;
}

export interface Account {
  accountNumber: string;
  accountName: string;
  color: string;
  settings: AccountSettings;
}

const DEFAULT_SETTINGS: AccountSettings = {
  startingCash: null,
  startingDate: null,
  initialLotPrice: null,
  sellPercentage: null,
  reductionFactor: null,
  orderWarnBelow: 3,
  orderBuffer: 5,
  callSafetyLevels: 8,
  putSafetyLevels: 8,
};

export interface Quote {
  price: number;
  changePercent: number;
  /** 1 = 3 consecutive up days, -1 = 3 consecutive down days, 0 = mixed/unknown */
  trend: number;
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
  filledOrders: FilledOrder[];
  filledOptionOrders: FilledOptionOrder[];
  expiredOptionOrders: ExpiredOptionOrder[];
  workingOrders: WorkingOrder[];
  optionPositions: OptionPosition[];
  transactions: Transaction[];
  tqqqShares: number;
  tqqqAvgPrice: number;
  snapshotLoading: boolean;
  balances: AccountBalance[];
  balancesLoading: boolean;
}

const STORAGE_KEY = "tqqq-accounts";
const ACTIVE_ACCOUNT_KEY = "tqqq-active-account";

const DEFAULT_ACCOUNTS: Account[] = [];

function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ACCOUNTS;
    const parsed = JSON.parse(raw) as Account[];
    return parsed.map((a) => ({
      ...a,
      settings: {
        ...a.settings,
        startingDate: a.settings.startingDate ? new Date(a.settings.startingDate) : null,
      },
    }));
  } catch {
    return DEFAULT_ACCOUNTS;
  }
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // Start with defaults (matches SSR), load localStorage after mount
  const [accounts, setAccounts] = useState<Account[]>(DEFAULT_ACCOUNTS);
  const [activeAccount, setActiveAccount] = useState<Account | null>(DEFAULT_ACCOUNTS[0] ?? null);
  // initialized becomes true after the first localStorage load — persists only fire after this
  const [initialized, setInitialized] = useState(false);
  // Prevents writing back to Supabase when the update originated from Supabase
  const loadingFromSupabase = useRef(false);

  useEffect(() => {
    // Load from localStorage immediately for a fast first render
    const savedAccounts = loadAccounts();
    const savedNumber = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    const saved = savedNumber ? savedAccounts.find((a) => a.accountNumber === savedNumber) : null;
    setAccounts(savedAccounts);
    setActiveAccount(saved ?? savedAccounts[0] ?? null);
    setInitialized(true);

    // Then fetch from Supabase and override if available (handles new devices)
    fetch("/api/settings?key=accounts")
      .then((r) => r.json())
      .then((data) => {
        if (!data.value) return;
        const remote = (data.value as Account[]).map((a) => ({
          ...a,
          settings: {
            ...a.settings,
            startingDate: a.settings.startingDate ? new Date(a.settings.startingDate) : null,
          },
        }));
        // Only use Supabase data if it has meaningful settings; otherwise keep localStorage
        const hasRealSettings = remote.some((a) =>
          a.settings.startingCash != null || a.settings.startingDate != null || a.settings.initialLotPrice != null
        );
        if (!hasRealSettings) return;
        loadingFromSupabase.current = true;
        setAccounts(remote);
        setActiveAccount((active) => {
          const preferred = localStorage.getItem(ACTIVE_ACCOUNT_KEY) ?? active?.accountNumber;
          return remote.find((a) => a.accountNumber === preferred) ?? remote[0] ?? null;
        });
      })
      .catch(() => {});
  }, []);

  // Persist accounts to localStorage and Supabase
  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    if (loadingFromSupabase.current) {
      loadingFromSupabase.current = false;
      return;
    }
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

  const syncAccountsFromSchwab = async () => {
    try {
      const res = await fetch("/api/schwab/accounts");
      const schwabAccounts = await res.json();
      if (!Array.isArray(schwabAccounts)) return;

      setAccounts((prev) => {
        const colors = ["blue", "teal", "violet", "orange", "pink", "grape"];
        const merged = schwabAccounts.map((sa: { accountNumber: string; nickName: string }, i: number) => {
          const existing = prev.find((a) => a.accountNumber === sa.accountNumber);
          return existing
            ? { ...existing, accountName: sa.nickName }
            : {
                accountNumber: sa.accountNumber,
                accountName: sa.nickName,
                color: colors[i % colors.length],
                settings: { ...DEFAULT_SETTINGS },
              };
        });
        setActiveAccount((active) => {
          const savedNumber = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
          const preferred = savedNumber ?? active?.accountNumber;
          return merged.find((a) => a.accountNumber === preferred) ?? merged[0] ?? null;
        });
        return merged;
      });
    } catch {
      // silently ignore — accounts remain as-is
    }
  };

  const checkSchwabAuth = async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      const connected = data.authenticated === true;
      setSchwabConnected(connected);
      if (connected) await syncAccountsFromSchwab();
    } catch {
      setSchwabConnected(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const res = await fetch("/api/auth/status");
        const data = await res.json();
        if (cancelled) return;
        const connected = data.authenticated === true;
        setSchwabConnected(connected);
        if (connected) await syncAccountsFromSchwab();
      } catch {
        if (!cancelled) setSchwabConnected(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);
  const [quote, setQuote] = useState<Quote>({ price: 0, changePercent: 0, trend: 0, loading: true });
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
        const res = await fetch("/api/schwab/data");
        const data = await res.json();
        if (cancelled) return;
        if (data.filledOrders) setAllFilledOrders(data.filledOrders);
        if (data.filledOptionOrders) setAllFilledOptionOrders(data.filledOptionOrders);
        if (data.expiredOptionOrders) setAllExpiredOptionOrders(data.expiredOptionOrders);
        if (data.workingOrders) setAllWorkingOrders(data.workingOrders);
        if (data.optionPositions) setAllOptionPositions(data.optionPositions);
        if (data.tqqqShares) setAllTqqqShares(data.tqqqShares);
        if (data.tqqqAvgPrice) setAllTqqqAvgPrice(data.tqqqAvgPrice);
        if (data.balances) setAllBalances(data.balances);
        if (data.transactions) setAllTransactions(data.transactions);
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
        filledOrders,
        filledOptionOrders,
        expiredOptionOrders,
        workingOrders,
        optionPositions,
        transactions,
        tqqqShares,
        tqqqAvgPrice,
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
