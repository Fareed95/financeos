import {
  Banknote,
  BedDouble,
  Briefcase,
  Car,
  Circle,
  Clapperboard,
  Ellipsis,
  Folder,
  Fuel,
  GraduationCap,
  HeartPulse,
  Laptop,
  Plane,
  PlusCircle,
  Receipt,
  Repeat,
  ShoppingBag,
  Undo2,
  User,
  Utensils,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  utensils: Utensils,
  plane: Plane,
  car: Car,
  "bed-double": BedDouble,
  "shopping-bag": ShoppingBag,
  receipt: Receipt,
  clapperboard: Clapperboard,
  "heart-pulse": HeartPulse,
  "graduation-cap": GraduationCap,
  repeat: Repeat,
  fuel: Fuel,
  user: User,
  briefcase: Briefcase,
  ellipsis: Ellipsis,
  banknote: Banknote,
  laptop: Laptop,
  "undo-2": Undo2,
  "plus-circle": PlusCircle,
  folder: Folder,
  circle: Circle,
};

export function CategoryIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = MAP[name ?? ""] ?? Circle;
  return <Icon className={className} />;
}
