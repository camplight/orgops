import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const variantClasses: Record<Variant, string> = {
  primary: "rounded bg-blue-600 hover:bg-blue-500 text-white",
  secondary: "rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${variantClasses[variant]} px-4 py-2 disabled:opacity-50 ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
