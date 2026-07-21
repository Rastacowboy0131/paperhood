import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PaperHood",
  description: "Paper trading terminal for Robinhood Chain",
};

// Runs before paint: applies persisted theme so there is no flash.
// Default is dark when nothing is stored; light is opt-in.
const themeBootScript = `(function(){try{var t=localStorage.getItem("theme");var d=t!=="light";var r=document.documentElement;r.classList.toggle("dark",d);var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m);}m.setAttribute("content",d?"#0e1013":"#ffffff");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script id="theme-boot" dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-7xl px-4 py-4">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
