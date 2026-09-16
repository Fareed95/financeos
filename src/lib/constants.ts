import type { AccountType, ProjectStatus, ProjectType, TxnType } from "./types";

export const APP_NAME = "FinanceOS";

export const DEFAULT_CATEGORIES: Array<{
  name: string;
  icon: string;
  type: "expense" | "income";
}> = [
  { name: "Food", icon: "utensils", type: "expense" },
  { name: "Travel", icon: "plane", type: "expense" },
  { name: "Transport", icon: "car", type: "expense" },
  { name: "Accommodation", icon: "bed-double", type: "expense" },
  { name: "Shopping", icon: "shopping-bag", type: "expense" },
  { name: "Bills", icon: "receipt", type: "expense" },
  { name: "Entertainment", icon: "clapperboard", type: "expense" },
  { name: "Healthcare", icon: "heart-pulse", type: "expense" },
  { name: "Education", icon: "graduation-cap", type: "expense" },
  { name: "Subscriptions", icon: "repeat", type: "expense" },
  { name: "Fuel", icon: "fuel", type: "expense" },
  { name: "Personal", icon: "user", type: "expense" },
  { name: "Business", icon: "briefcase", type: "expense" },
  { name: "Other", icon: "ellipsis", type: "expense" },
  { name: "Salary", icon: "banknote", type: "income" },
  { name: "Freelance", icon: "laptop", type: "income" },
  { name: "Refund", icon: "undo-2", type: "income" },
  { name: "Other Income", icon: "plus-circle", type: "income" },
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank",
  cash: "Cash",
  upi: "UPI",
  credit_card: "Credit card",
  wallet: "Wallet",
  other: "Other",
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  trip: "Trip",
  wedding: "Wedding",
  hackathon: "Hackathon",
  business: "Business",
  personal: "Personal",
  other: "Other",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "Planned",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

export const TXN_TYPE_LABELS: Record<TxnType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  refund: "Refund",
};

export const QUICK_TRIP_CATEGORIES = [
  "Food",
  "Transport",
  "Shopping",
  "Accommodation",
  "Entertainment",
  "Other",
] as const;

export const CURRENCY_LABELS: Record<string, string> = {
  INR: "Indian Rupee",
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  AED: "UAE Dirham",
  SGD: "Singapore Dollar",
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
};
