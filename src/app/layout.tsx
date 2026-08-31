import type { Metadata } from "next";
import { fontVariables } from "@/lib/fonts";
import { ThemeLocaleProvider, noFlashScript } from "@/components/providers/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "PPM Platform",
  description: "Facility maintenance management for the Gulf market.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className={`${fontVariables} font-body antialiased`} suppressHydrationWarning>
        <ThemeLocaleProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeLocaleProvider>
      </body>
    </html>
  );
}
