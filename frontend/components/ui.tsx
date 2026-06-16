import Link from "next/link";
import type { ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "muted";

interface AppShellProps {
  title: string;
  actionHref?: string;
  actionLabel?: string;
  children: ReactNode;
}

interface ButtonProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  form?: string;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: ButtonVariant;
  download?: boolean;
}

export function AppShell({
  title,
  actionHref,
  actionLabel,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#eeeeee] text-black">
      <header className="bg-black">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 pb-24 pt-16 sm:px-6">
          <h1 className="text-2xl font-semibold tracking-normal text-white">
            {title}
          </h1>
          {actionHref && actionLabel ? (
            <Link
              href={actionHref}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-white/20 bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-zinc-100"
            >
              {actionLabel}
            </Link>
          ) : null}
        </div>
      </header>
      <main className="mx-auto -mt-16 max-w-6xl space-y-5 px-5 pb-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-zinc-300 bg-white p-5 ${className}`}>
      {children}
    </section>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="min-h-36 rounded-lg border border-zinc-300 bg-white p-5">
      <p className="text-sm font-semibold text-zinc-700">{label}</p>
      <p className="mt-4 text-5xl font-semibold tracking-normal text-black">
        {value}
      </p>
    </article>
  );
}

export function ActionButton({
  children,
  className = "",
  disabled = false,
  form,
  href,
  onClick,
  type = "button",
  variant = "primary",
  download = false,
}: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? "bg-black text-white hover:bg-zinc-800 disabled:bg-zinc-300 disabled:text-zinc-600"
      : variant === "secondary"
        ? "border border-zinc-300 bg-white text-black hover:bg-zinc-50 disabled:text-zinc-400"
        : "bg-zinc-100 text-zinc-500";
  const classNames = `inline-flex min-h-10 items-center justify-center rounded-lg px-5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${variantClass} ${className}`;

  if (href) {
    return (
      <a href={href} download={download} className={classNames}>
        {children}
      </a>
    );
  }

  return (
    <button
      type={type}
      form={form}
      disabled={disabled}
      onClick={onClick}
      className={classNames}
    >
      {children}
    </button>
  );
}

export function Message({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "error" | "success";
}) {
  const classes =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <p className={`rounded-lg border px-4 py-3 text-sm font-medium ${classes}`}>
      {children}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-white text-sm font-medium text-zinc-500">
      {children}
    </div>
  );
}

export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`rounded-full bg-zinc-200 ${className}`} />;
}

export function TableFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white">
      <div className="max-h-[650px] overflow-auto">{children}</div>
    </div>
  );
}

export function TableHeaderCell({ children }: { children: ReactNode }) {
  return (
    <th className="whitespace-nowrap border-b border-r border-zinc-800 bg-black px-4 py-3 text-left text-xs font-semibold uppercase text-white last:border-r-0">
      {children}
    </th>
  );
}

export function TableCell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={`border-b border-zinc-100 px-4 py-3 text-sm text-zinc-700 ${className}`}>
      {children}
    </td>
  );
}
