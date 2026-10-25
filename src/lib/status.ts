import type { SegmentStatus } from "@/db/schema";

export const STATUS_ORDER: SegmentStatus[] = ["red", "yellow", "green"];

export const STATUS_META: Record<SegmentStatus, { label: string; color: string; swatch: string }> = {
  red: { label: "Sin empapelar", color: "#dc2626", swatch: "bg-red-600" },
  yellow: { label: "Carteles deteriorados", color: "#eab308", swatch: "bg-yellow-500" },
  green: { label: "Empapelada", color: "#16a34a", swatch: "bg-green-600" },
};
