"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import type {
  FilledOrder,
  FilledOptionOrder,
  ExpiredOptionOrder,
  WorkingOrder,
  OptionPosition,
} from "@/lib/schwab/parse";
import type { Transaction, AccountBalance } from "@/app/api/schwab/data/route";
import {
  needsSnapshotUpdate,
  recordSnapshot,
  type BalanceSnapshot,
} from "@/lib/balanceHistory";
import { toDateKey } from "@/lib/format";
export type {
  FilledOrder,
  FilledOptionOrder,
  ExpiredOptionOrder,
  WorkingOrder,
  OptionPosition,
  Transaction,
  AccountBalance,
  BalanceSnapshot,
};

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
  /** QQQ-put order IDs the user manually flipped from their DTE-based budget default. */
  hedgeBudgetFlippedOrderIds: number[] | null;
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
  callSafetyLevels: 15,
  putSafetyLevels: 15,
  levelResetDate: null,
  hedgeBudgetFlippedOrderIds: null,
};

export interface Quote {
  price: number;
  changePercent: number;
  /** 1 = last 6 daily closes strictly rising, -1 = strictly falling, 0 = mixed/unknown */
  trend: number;
  /** Last ~30 trading day closing prices */
  closes30: number[];
  /** Dates for closes30, formatted as "M/D" */
  dates30: string[];
  /** Day of week (0=Sun…6=Sat) for each closes30 entry */
  daysOfWeek30: number[];
  /** Yahoo market session: REGULAR, PRE, POST, CLOSED, etc. Drives market-hours polling. */
  marketState?: string;
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
  updateAccountSettings: (
    accountNumber: string,
    settings: Partial<AccountSettings>,
  ) => void;
  privacyMode: boolean;
  togglePrivacy: () => void;
  lastRefreshed: Date | null;
  setLastRefreshed: (date: Date) => void;
  quote: Quote;
  setQuote: React.Dispatch<React.SetStateAction<Quote>>;
  refreshTick: number;
  tickRefresh: (opts?: { silent?: boolean }) => void;
  quoteTick: number;
  tickQuoteRefresh: (opts?: { silent?: boolean }) => void;
  alerts: Alerts;
  setAlerts: React.Dispatch<React.SetStateAction<Alerts>>;
  schwabConnected: boolean | null; // null = loading
  checkSchwabAuth: () => Promise<void>;
  tastytradeConnected: boolean | null; // null = loading
  checkTastytradeAuth: () => Promise<string | null>;
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
  balanceHistory: BalanceSnapshot[];
}

const DEFAULT_ACCOUNTS: Account[] = [];

export function deserializeAccount(a: Account): Account {
  const raw = a.settings as unknown as Record<string, unknown>;
  return {
    ...a,
    settings: {
      ...a.settings,
      // Migrate old field name → new field name
      levelStartingCash:
        a.settings.levelStartingCash ??
        (raw.startingCash as number | null) ??
        null,
      startingDate: a.settings.startingDate
        ? new Date(a.settings.startingDate)
        : null,
      levelResetDate: a.settings.levelResetDate
        ? new Date(a.settings.levelResetDate)
        : null,
    },
  };
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // Start with empty defaults (matches SSR); init effect loads from Supabase before enabling writes
  const [accounts, setAccounts] = useState<Account[]>(DEFAULT_ACCOUNTS);
  const [activeAccount, setActiveAccount] = useState<Account | null>(
    DEFAULT_ACCOUNTS[0] ?? null,
  );
  // initialized becomes true after settings are loaded from the database — persists only fire after this
  const [initialized, setInitialized] = useState(false);
  // ref-based guard so the persist effects only fire on changes AFTER init, not during the initial load
  const persistReadyRef = useRef(false);
  // true only when Supabase returned at least one account on init — guards against overwriting real data
  // with all-null defaults when the settings load fails (network hiccup, cold start, etc.)
  const supabaseLoadedRef = useRef(false);
  // Always-current accounts ref for the snapshot effect, whose closure captures accounts at the
  // time refreshTick last changed — which may be before Tastytrade accounts are discovered.
  // Without this, tastyNums would be built from a stale empty-accounts snapshot and the merge
  // logic would incorrectly wipe Tastytrade option positions when Schwab data arrives.
  const accountsRef = useRef(accounts);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  // Persist accounts to Supabase whenever they change (after initial load)
  useEffect(() => {
    if (!persistReadyRef.current) return;
    // If the initial Supabase load failed, don't persist accounts that are entirely default settings.
    // This prevents a failed init from overwriting real saved data with empty defaults.
    // Only fields that default to null indicate real user configuration — orderBuffer, orderWarnBelow,
    // callSafetyLevels, and putSafetyLevels all have non-null defaults, so they don't count.
    const hasRealSettings = accounts.some((a) =>
      (Object.keys(DEFAULT_SETTINGS) as (keyof AccountSettings)[]).some(
        (key) => DEFAULT_SETTINGS[key] === null && a.settings[key] !== null,
      ),
    );
    if (!supabaseLoadedRef.current && !hasRealSettings) return;
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "accounts", value: accounts }),
    }).catch(() => {});
  }, [accounts]);

  // Persist active account selection to Supabase
  useEffect(() => {
    if (!persistReadyRef.current) return;
    if (!activeAccount) return;
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "activeAccountNumber",
        value: activeAccount.accountNumber,
      }),
    }).catch(() => {});
  }, [activeAccount]);

  const [privacyMode, setPrivacyMode] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [schwabConnected, setSchwabConnected] = useState<boolean | null>(null);
  const [tastytradeConnected, setTastytradeConnected] = useState<
    boolean | null
  >(null);

  const syncAccountsFromSchwab = useCallback(
    async (preferredAccountNumber?: string | null) => {
      try {
        const res = await fetch("/api/schwab/accounts");
        const schwabAccounts = await res.json();
        if (!Array.isArray(schwabAccounts)) return;

        setAccounts((prev) => {
          const colors = ["blue", "teal", "violet", "orange", "pink", "grape"];
          const nonSchwab = prev.filter((a) => a.broker === "tastytrade"); // undefined = legacy schwab, exclude
          const merged = schwabAccounts.map(
            (sa: { accountNumber: string; nickName: string }, i: number) => {
              const existing = prev.find(
                (a) => a.accountNumber === sa.accountNumber,
              );
              return existing
                ? {
                    ...existing,
                    accountName: sa.nickName,
                    broker: "schwab" as const,
                  }
                : {
                    accountNumber: sa.accountNumber,
                    accountName: sa.nickName,
                    color: colors[i % colors.length],
                    broker: "schwab" as const,
                    settings: { ...DEFAULT_SETTINGS },
                  };
            },
          );
          const allAccounts = [...merged, ...nonSchwab];
          setActiveAccount((active) => {
            const preferred = preferredAccountNumber ?? active?.accountNumber;
            return (
              allAccounts.find((a) => a.accountNumber === preferred) ??
              allAccounts[0] ??
              null
            );
          });
          return allAccounts;
        });
      } catch {
        // silently ignore — accounts remain as-is
      }
    },
    [],
  );

  const syncAccountsFromTastytrade = useCallback(async (): Promise<
    string | null
  > => {
    try {
      const res = await fetch("/api/tastytrade/accounts");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return `accounts fetch failed (${res.status}): ${body.error ?? "unknown"}`;
      }
      const tastyAccounts = await res.json();
      if (!Array.isArray(tastyAccounts)) return null;

      setAccounts((prev) => {
        const colors = ["blue", "teal", "violet", "orange", "pink", "grape"];
        const nonTasty = prev.filter((a) => a.broker !== "tastytrade"); // keep schwab + legacy (undefined)
        const merged = tastyAccounts.map(
          (ta: { accountNumber: string; nickName: string }, i: number) => {
            const existing = prev.find(
              (a) => a.accountNumber === ta.accountNumber,
            );
            const colorIdx = nonTasty.length + i;
            return existing
              ? {
                  ...existing,
                  accountName: ta.nickName,
                  broker: "tastytrade" as const,
                }
              : {
                  accountNumber: ta.accountNumber,
                  accountName: ta.nickName,
                  color: colors[colorIdx % colors.length],
                  broker: "tastytrade" as const,
                  settings: { ...DEFAULT_SETTINGS },
                };
          },
        );
        return [...nonTasty, ...merged];
      });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "unknown error";
    }
  }, []);

  const checkTastytradeAuth = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/tastytrade/auth");
      const data = await res.json();
      const connected = data.connected === true;
      setTastytradeConnected(connected);
      if (connected) return await syncAccountsFromTastytrade();
      return null;
    } catch {
      setTastytradeConnected(false);
      return null;
    }
  }, [syncAccountsFromTastytrade]);

  const checkSchwabAuth = useCallback(async () => {
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
  }, [checkTastytradeAuth, syncAccountsFromSchwab]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      // 1. Load accounts + saved active account + balance history from Supabase (source of truth)
      let remoteAccounts: Account[] = [];
      let savedNumber: string | null = null;
      try {
        const [accountsData, activeNumData, historyData] =
          await Promise.allSettled([
            fetch("/api/settings?key=accounts").then((r) => r.json()),
            fetch("/api/settings?key=activeAccountNumber").then((r) =>
              r.json(),
            ),
            fetch("/api/settings?key=balanceHistory").then((r) => r.json()),
          ]);
        if (!cancelled) {
          if (
            accountsData.status === "fulfilled" &&
            accountsData.value?.value
          ) {
            remoteAccounts = (accountsData.value.value as Account[]).map(
              deserializeAccount,
            );
            setAccounts(remoteAccounts);
            supabaseLoadedRef.current = true;
          }
          if (
            activeNumData.status === "fulfilled" &&
            activeNumData.value?.value
          ) {
            savedNumber = activeNumData.value.value as string;
          }
          if (historyData.status === "fulfilled") {
            if (Array.isArray(historyData.value?.value)) {
              setBalanceHistory(historyData.value.value as BalanceSnapshot[]);
            }
            // Batched with setBalanceHistory so the snapshot effect never sees
            // persistReadyRef=true with a stale (empty) balanceHistory.
            setBalanceHistoryLoaded(true);
          }
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

        const connected =
          schwabRes.status === "fulfilled" &&
          schwabRes.value?.authenticated === true;
        const tastyConnected =
          tastyRes.status === "fulfilled" && tastyRes.value?.connected === true;
        setSchwabConnected(connected);
        setTastytradeConnected(tastyConnected);

        if (tastyConnected) await syncAccountsFromTastytrade();
        if (cancelled) return;
        if (connected) {
          await syncAccountsFromSchwab(savedNumber); // sets activeAccount internally
        } else {
          setActiveAccount(
            (savedNumber
              ? remoteAccounts.find((a) => a.accountNumber === savedNumber)
              : null) ??
              remoteAccounts[0] ??
              null,
          );
        }
      } catch {
        if (!cancelled) {
          setSchwabConnected(false);
          setTastytradeConnected(false);
          setActiveAccount(
            (savedNumber
              ? remoteAccounts.find((a) => a.accountNumber === savedNumber)
              : null) ??
              remoteAccounts[0] ??
              null,
          );
        }
      }

      // 3. Enable persistence writes now that initial load is complete
      if (!cancelled) {
        persistReadyRef.current = true;
        setInitialized(true);
      }

      // 4. Once per day, snapshot settings to settings_backups for recovery from accidental overwrites
      const today = toDateKey(new Date());
      if (!cancelled && localStorage.getItem("settingsBackupDate") !== today) {
        fetch("/api/settings/backup", { method: "POST" })
          .then(() => localStorage.setItem("settingsBackupDate", today))
          .catch(() => {});
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);
  const [quote, setQuote] = useState<Quote>({
    price: 0,
    changePercent: 0,
    trend: 0,
    closes30: [],
    dates30: [],
    daysOfWeek30: [],
    loading: true,
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const [quoteTick, setQuoteTick] = useState(0);
  // Set by a user-initiated refresh so the next snapshot fetch bypasses the server-side TTL cache.
  // Consumed (and reset) by the snapshot effect; mount/focus refreshes leave it false to use cache.
  const forceFreshRef = useRef(false);
  const [allFilledOrders, setAllFilledOrders] = useState<FilledOrder[]>([]);
  const [allFilledOptionOrders, setAllFilledOptionOrders] = useState<
    FilledOptionOrder[]
  >([]);
  const [allExpiredOptionOrders, setAllExpiredOptionOrders] = useState<
    ExpiredOptionOrder[]
  >([]);
  const [allWorkingOrders, setAllWorkingOrders] = useState<WorkingOrder[]>([]);
  const [allOptionPositions, setAllOptionPositions] = useState<
    OptionPosition[]
  >([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [allTqqqShares, setAllTqqqShares] = useState<Record<string, number>>(
    {},
  );
  const [allTqqqAvgPrice, setAllTqqqAvgPrice] = useState<
    Record<string, number>
  >({});
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [allBalances, setAllBalances] = useState<AccountBalance[]>([]);
  const [balanceHistory, setBalanceHistory] = useState<BalanceSnapshot[]>([]);
  // Set to true in the same React batch as setBalanceHistory so the snapshot effect
  // never sees persistReadyRef=true + balanceHistory=[] at the same time.
  const [balanceHistoryLoaded, setBalanceHistoryLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let requestsComplete = 0;

    const markComplete = () => {
      requestsComplete++;
      if (requestsComplete === 2 && !cancelled) {
        setSnapshotLoading(false);
      }
    };

    setSnapshotLoading(true);

    function mergeByTime<T>(a: T[] = [], b: T[] = [], key: keyof T): T[] {
      return [...a, ...b].sort(
        (x, y) =>
          new Date(y[key] as string).getTime() -
          new Date(x[key] as string).getTime(),
      );
    }

    // Each broker owns the accounts it returns. When one broker's payload arrives we replace its
    // own accounts' slices and retain the other broker's data from the previous state. Both fetches
    // run through this one helper so the merge rules can't drift apart between them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyData = (data: any, incomingIsTasty: boolean) => {
      if (cancelled || !Array.isArray(data?.filledOrders)) return;
      // Read from the ref at call time, not from the stale closure captured when the effect ran.
      // The init effect may discover Tastytrade accounts after this effect has already started its
      // fetches; reading the ref here ensures the correct account numbers are always used.
      const tastyNums = new Set(
        accountsRef.current
          .filter((a) => a.broker === "tastytrade")
          .map((a) => a.accountNumber),
      );
      const owns = (acct: string) =>
        incomingIsTasty ? tastyNums.has(acct) : !tastyNums.has(acct);
      const keepOther = <T extends { accountNumber: string }>(arr: T[]) =>
        arr.filter((o) => !owns(o.accountNumber));
      // For unsorted slices, keep the Schwab partition first to preserve prior ordering.
      const concat = <T extends { accountNumber: string }>(
        prev: T[],
        incoming: T[],
      ) =>
        incomingIsTasty
          ? [...keepOther(prev), ...incoming]
          : [...incoming, ...keepOther(prev)];

      setAllFilledOrders((prev) =>
        mergeByTime(keepOther(prev), data.filledOrders ?? [], "time" as never),
      );
      setAllFilledOptionOrders((prev) =>
        mergeByTime(
          keepOther(prev),
          data.filledOptionOrders ?? [],
          "time" as never,
        ),
      );
      setAllExpiredOptionOrders((prev) =>
        mergeByTime(
          keepOther(prev),
          data.expiredOptionOrders ?? [],
          "time" as never,
        ),
      );
      setAllWorkingOrders((prev) =>
        mergeByTime(
          keepOther(prev),
          data.workingOrders ?? [],
          "enteredTime" as never,
        ),
      );
      setAllOptionPositions((prev) => concat(prev, data.optionPositions ?? []));
      setAllBalances((prev) => concat(prev, data.balances ?? []));
      setAllTransactions((prev) =>
        mergeByTime(keepOther(prev), data.transactions ?? [], "time" as never),
      );
      setAllTqqqShares((prev) => ({ ...prev, ...(data.tqqqShares ?? {}) }));
      setAllTqqqAvgPrice((prev) => ({ ...prev, ...(data.tqqqAvgPrice ?? {}) }));
    };

    // A user-initiated refresh bypasses the server cache; mount/focus reuse it. Read + reset here so
    // the flag applies to exactly this fetch cycle.
    const freshParam = forceFreshRef.current ? "?fresh=1" : "";
    forceFreshRef.current = false;

    // Process each broker's data as soon as it arrives — neither blocks the other.
    fetch(`/api/schwab/data${freshParam}`)
      .then((r) => r.json())
      .then((s) => applyData(s, false))
      .catch(() => {
        /* ignore */
      })
      .finally(() => markComplete());

    fetch(`/api/tastytrade/data${freshParam}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => {
        if (cancelled) return;
        if (t === null) {
          checkTastytradeAuth();
          return;
        }
        applyData(t, true);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => markComplete());

    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  // Record one balance snapshot per day, the first time balances finish loading that day. This
  // piggybacks on the existing refresh flow — no cron/infra needed — so the portfolio-history
  // chart fills in naturally as the app is used.
  useEffect(() => {
    if (
      snapshotLoading ||
      allBalances.length === 0 ||
      !persistReadyRef.current ||
      !balanceHistoryLoaded
    )
      return;
    const today = toDateKey(new Date());
    const accountNumbers = allBalances.map((b) => b.accountNumber);
    // Record when today is missing entirely, or is missing an account we now have a balance for
    // (e.g. the second broker finished loading after the day's first snapshot was taken).
    if (!needsSnapshotUpdate(balanceHistory, today, accountNumbers)) return;

    const values = Object.fromEntries(
      allBalances.map((b) => [b.accountNumber, b.totalValue]),
    );
    const next = recordSnapshot(balanceHistory, today, values);
    setBalanceHistory(next);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "balanceHistory", value: next }),
    }).catch(() => {});
  }, [allBalances, snapshotLoading, balanceHistory, balanceHistoryLoaded]);

  const accountNumber = activeAccount?.accountNumber ?? null;
  const filledOrders = useMemo(
    () =>
      accountNumber
        ? allFilledOrders.filter((o) => o.accountNumber === accountNumber)
        : [],
    [allFilledOrders, accountNumber],
  );
  const workingOrders = useMemo(
    () =>
      accountNumber
        ? allWorkingOrders.filter((o) => o.accountNumber === accountNumber)
        : [],
    [allWorkingOrders, accountNumber],
  );
  const optionPositions = useMemo(
    () =>
      accountNumber
        ? allOptionPositions.filter((o) => o.accountNumber === accountNumber)
        : [],
    [allOptionPositions, accountNumber],
  );
  const filledOptionOrders = useMemo(
    () =>
      accountNumber
        ? allFilledOptionOrders.filter((o) => o.accountNumber === accountNumber)
        : [],
    [allFilledOptionOrders, accountNumber],
  );
  const expiredOptionOrders = useMemo(
    () =>
      accountNumber
        ? allExpiredOptionOrders.filter(
            (o) => o.accountNumber === accountNumber,
          )
        : [],
    [allExpiredOptionOrders, accountNumber],
  );
  const transactions = useMemo(
    () =>
      accountNumber
        ? allTransactions.filter((t) => t.accountNumber === accountNumber)
        : [],
    [allTransactions, accountNumber],
  );
  const tqqqShares = useMemo(
    () => (accountNumber ? (allTqqqShares[accountNumber] ?? 0) : 0),
    [allTqqqShares, accountNumber],
  );
  const tqqqAvgPrice = useMemo(
    () => (accountNumber ? (allTqqqAvgPrice[accountNumber] ?? 0) : 0),
    [allTqqqAvgPrice, accountNumber],
  );
  const [alerts, setAlerts] = useState<Alerts>({
    levelMatch: null,
    workingOrders: null,
    duplicateOrders: null,
    expiringOptions: null,
    itmOptions: null,
    idleCash: null,
  });

  const updateAccountColor = useCallback(
    (accountNumber: string, color: string) => {
      setAccounts((prev) =>
        prev.map((a) =>
          a.accountNumber === accountNumber ? { ...a, color } : a,
        ),
      );
      setActiveAccount((prev) =>
        prev?.accountNumber === accountNumber ? { ...prev, color } : prev,
      );
    },
    [],
  );

  const updateAccountSettings = useCallback(
    (accountNumber: string, settings: Partial<AccountSettings>) => {
      setAccounts((prev) =>
        prev.map((a) =>
          a.accountNumber === accountNumber
            ? { ...a, settings: { ...a.settings, ...settings } }
            : a,
        ),
      );
      setActiveAccount((prev) =>
        prev?.accountNumber === accountNumber
          ? { ...prev, settings: { ...prev.settings, ...settings } }
          : prev,
      );
    },
    [],
  );

  const togglePrivacy = useCallback(() => setPrivacyMode((p) => !p), []);
  // opts.silent skips the loading flash — used by background polling / focus refresh so the
  // header price and chart update in place without flickering skeletons. Memoized for stable
  // identity so the market-hours polling effect doesn't reset its interval on every render.
  const tickRefresh = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setQuote((q) => ({ ...q, loading: true }));
      forceFreshRef.current = true; // user asked for it explicitly → bypass the cache
    }
    setRefreshTick((t) => t + 1);
  }, []);
  const tickQuoteRefresh = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setQuote((q) => ({ ...q, loading: true }));
    setQuoteTick((t) => t + 1);
  }, []);

  // Memoize the context value so a quote tick or poll doesn't hand every useApp()
  // consumer a fresh object and force the whole subtree (heavy order tables included)
  // to re-render. Identity only changes when one of the referenced values changes.
  const value = useMemo<AppContextValue>(
    () => ({
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
      balanceHistory,
    }),
    [
      accounts,
      activeAccount,
      updateAccountColor,
      updateAccountSettings,
      privacyMode,
      togglePrivacy,
      lastRefreshed,
      quote,
      refreshTick,
      tickRefresh,
      quoteTick,
      tickQuoteRefresh,
      alerts,
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
      allBalances,
      balanceHistory,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
