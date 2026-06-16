import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERP Formatter",
  description: "Internal ERP formatting tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-950 antialiased">
        <nav className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-14 max-w-6xl items-center px-6 text-sm font-semibold">
            ERP Formatter
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
