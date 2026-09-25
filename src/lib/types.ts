export const ACCOUNT_TYPES = ["bank", "cash", "upi", "credit_card", "wallet", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_TYPES = ["expense", "income"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const PROJECT_TYPES = ["trip", "wedding", "hackathon", "business", "personal", "other"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STATUSES = ["planned", "active", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TXN_TYPES = ["expense", "income", "transfer", "refund"] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const BUDGET_PERIODS = ["weekly", "monthly", "yearly", "custom"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export type Profile = {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  currency: string;
  theme: string;
  onboardingCompleted: boolean;
};

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  openingBalance: string;
  currentBalance: string;
  currency: string;
  isActive: boolean;
  isDemo: boolean;
};

export type Category = {
  id: string;
  name: string;
  icon: string;
  type: CategoryType;
  isActive: boolean;
  isDefault: boolean;
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  projectType: ProjectType;
  startDate: string | null;
  endDate: string | null;
  budget: string;
  status: ProjectStatus;
  icon: string;
  isDemo: boolean;
  collaboration: "personal" | "collaborative";
  totalCost: string;
  /** What this viewer has used of the project budget. Personal projects match total cost. */
  viewerSpend: string;
  prepaid: string;
  duringTrip: string;
  contributions: string;
  netCost: string;
  remaining: string;
  txnCount: number;
};

export type Transaction = {
  id: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  projectId: string | null;
  projectName: string | null;
  counterpartyAccountId: string | null;
  counterpartyAccountName: string | null;
  type: TxnType;
  amount: string;
  transactionDate: string;
  transactionTime: string | null;
  description: string | null;
  notes: string | null;
  isPrepaid: boolean;
  isCommitted: boolean;
  isDemo: boolean;
  hasReceipt: boolean;
  createdAt: string;
  visibility?: "personal" | "shared" | "private";
  paidByName?: string | null;
};

export type Budget = {
  id: string;
  name: string;
  amount: string;
  period: BudgetPeriod;
  startDate: string;
  endDate: string;
  categoryId: string | null;
  categoryName: string | null;
  spent: string;
  remaining: string;
  percent: number;
};

export type ProjectBudget = {
  id: string;
  projectId: string;
  categoryId: string | null;
  categoryName: string | null;
  amount: string;
  spent: string;
};

export type Attachment = {
  id: string;
  transactionId: string;
  fileName: string;
  mimeType: string;
  dataUrl: string | null;
};

export type MonthStats = {
  from: string;
  to: string;
  income: string;
  expense: string;
  savings: string;
  netWorth: string;
};

export type CategorySpend = {
  categoryId: string | null;
  name: string;
  icon: string;
  amount: string;
};

export type DailySpend = {
  date: string;
  expense: string;
  income: string;
};

export type TripInsights = {
  budget: string;
  totalCost: string;
  prepaid: string;
  duringTrip: string;
  remaining: string;
  contributions: string;
  netCost: string;
  mySpend: string;
  sharedSpend: string;
  personalSpend: string;
  youPaid: string;
  yourShare: string;
  myIncome: string;
  todaySpend: string;
  averageDaily: string;
  remainingDays: number;
  recommendedDaily: string;
  overDaily: boolean;
  categoryBreakdown: CategorySpend[];
  daily: DailySpend[];
};

export type Bootstrap = {
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  projects: Project[];
  budgets: Budget[];
  stats: MonthStats;
  recent: Transaction[];
};

export type TxnFilters = {
  from?: string;
  to?: string;
  categoryId?: string;
  accountId?: string;
  projectId?: string;
  type?: TxnType;
  search?: string;
  sort?: "newest" | "oldest" | "highest" | "lowest";
  limit?: number;
  offset?: number;
};
