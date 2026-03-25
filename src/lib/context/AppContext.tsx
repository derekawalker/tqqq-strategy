"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface AccountSettings {
  startingCash: number | null;
  startingDate: Date | null;
  initialLotPrice: number | null;
  sellPercentage: number | null;
  reductionFactor: number | null;
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
};

export interface Quote {
  price: number;
  changePercent: number;
  loading: boolean;
}

export interface Alerts {
  gridMatch: boolean | null;
  workingOrders: boolean | null;
  duplicateOrders: number | null;
  expiringOptions: number | null;
  itmOptions: number | null;
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
  alerts: Alerts;
  setAlerts: (alerts: Alerts) => void;
}

const STORAGE_KEY = "tqqq-accounts";

const DEFAULT_ACCOUNTS: Account[] = [
  { accountNumber: "111111111", accountName: "Roth IRA", color: "blue", settings: { ...DEFAULT_SETTINGS } },
  { accountNumber: "222222222", accountName: "Brokerage", color: "teal", settings: { ...DEFAULT_SETTINGS } },
  { accountNumber: "333333333", accountName: "Rollover IRA", color: "violet", settings: { ...DEFAULT_SETTINGS } },
];

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
  const [accounts, setAccounts] = useState<Account[]>(DEFAULT_ACCOUNTS);
  const [activeAccount, setActiveAccount] = useState<Account | null>(DEFAULT_ACCOUNTS[0]);

  // Load from localStorage once on mount
  useEffect(() => {
    const saved = loadAccounts();
    setAccounts(saved);
    setActiveAccount(saved[0]);
  }, []);

  // Persist whenever accounts change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  }, [accounts]);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [quote, setQuote] = useState<Quote>({ price: 0, changePercent: 0, loading: true });
  const [refreshTick, setRefreshTick] = useState(0);
  const [alerts, setAlerts] = useState<Alerts>({
    gridMatch: null,
    workingOrders: null,
    duplicateOrders: null,
    expiringOptions: null,
    itmOptions: null,
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
        alerts,
        setAlerts,
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
