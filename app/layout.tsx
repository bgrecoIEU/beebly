import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Beebly: student ticket resale",
  description:
    "Resell and buy event tickets safely through a live order book for IE University students.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before hydration. */}
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <Header />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-stone-200 bg-white">
          <p className="mx-auto max-w-5xl px-4 py-4 text-center text-sm text-stone-600">
            Beebly is a student prototype. No real payments or tickets are processed.
          </p>
        </footer>
      </body>
    </html>
  );
}
