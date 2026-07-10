import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const sizeClass = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-caption",
  lg: "size-10 text-body-ui",
} as const;

// 依 user id 穩定配色（設計規範 §4.4）
const palette = [
  "bg-primary-100 text-primary-700",
  "bg-success-tint text-success",
  "bg-warning-tint text-warning",
  "bg-danger-tint text-danger",
  "bg-ai-tint text-ai",
] as const;

function hashCode(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** 中文姓名慣例取末二字（設計規範 §4.4）；西文取首字母縮寫。 */
export function avatarInitials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/^[\x20-\x7e]+$/.test(trimmed)) {
    return trimmed
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => (part[0] ?? "").toUpperCase())
      .join("");
  }
  return trimmed.slice(-2);
}

export interface AvatarProps {
  name: string;
  /** 穩定配色 key（user id）；未提供時以 name 計算 */
  colorKey?: string;
  size?: keyof typeof sizeClass;
  className?: string;
}

export function Avatar({ name, colorKey, size = "md", className }: AvatarProps) {
  const color = palette[hashCode(colorKey ?? name) % palette.length];
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium",
        sizeClass[size],
        color,
        className,
      )}
    >
      {avatarInitials(name)}
    </span>
  );
}

export interface AvatarGroupProps {
  names: string[];
  max?: number;
  size?: keyof typeof sizeClass;
  className?: string;
  children?: ReactNode;
}

/** 頭像堆疊 -8px、超過上限顯示 +N（設計規範 §4.4）。 */
export function AvatarGroup({ names, max = 4, size = "md", className }: AvatarGroupProps) {
  const visible = names.slice(0, max);
  const overflow = names.length - visible.length;
  return (
    <span className={cn("inline-flex items-center", className)}>
      {visible.map((name, index) => (
        <span key={`${name}-${index}`} className={index > 0 ? "-ml-2" : undefined}>
          <Avatar name={name} size={size} className="ring-2 ring-raised" />
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            "-ml-2 inline-flex select-none items-center justify-center rounded-full bg-hover font-medium text-fg-secondary ring-2 ring-raised",
            sizeClass[size],
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
