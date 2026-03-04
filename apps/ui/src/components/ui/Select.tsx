import type { SelectHTMLAttributes } from "react";

const selectClassName =
  "w-full rounded bg-slate-800 border border-slate-700 p-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-600";

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${selectClassName} ${className}`.trim()} {...props}>
      {children}
    </select>
  );
}
