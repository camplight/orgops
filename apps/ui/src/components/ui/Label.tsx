import type { LabelHTMLAttributes } from "react";

export function Label({
  className = "",
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={`text-sm text-slate-300 ${className}`.trim()} {...props}>
      {children}
    </label>
  );
}
