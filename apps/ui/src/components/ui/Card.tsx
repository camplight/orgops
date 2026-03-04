import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

export function Card({ title, children, className = "" }: CardProps) {
  return (
    <section
      className={`bg-slate-900 rounded-lg p-4 space-y-3 ${className}`.trim()}
    >
      {title && <h2 className="text-lg font-semibold text-slate-100">{title}</h2>}
      {children}
    </section>
  );
}
