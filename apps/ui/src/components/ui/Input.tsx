import type { InputHTMLAttributes } from "react";

const inputClassName =
  "w-full rounded bg-slate-800 border border-slate-700 p-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-600";

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClassName} ${className}`.trim()} {...props} />;
}
