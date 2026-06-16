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
      <body className="min-h-screen bg-[#eeeeee] text-black antialiased">
        <main>{children}</main>
      </body>
    </html>
  );
}
