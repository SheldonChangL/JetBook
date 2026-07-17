import { cn } from "@/lib/utils";

export function ArchiveMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} fill="none">
      <path d="M4 5h20l4 5v17H4z" className="fill-primary-tint stroke-primary" strokeWidth="1.5" />
      <path d="M8 10h16M8 15h16M8 20h10" className="stroke-primary" strokeWidth="1.5" />
      <path d="M22 5v6h6" className="stroke-primary" strokeWidth="1.5" />
    </svg>
  );
}
