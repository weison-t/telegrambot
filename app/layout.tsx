import type { Metadata } from "next";
import "./globals.css";
import { SidebarNav } from "@/components/sidebar-nav";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Telegram Keyboard Warrior",
  description:
    "Orchestrate AI-driven conversations across real Telegram accounts.",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en" suppressHydrationWarning>
    <body className="min-h-screen bg-background antialiased">
      <div className="flex min-h-screen">
        <SidebarNav />
        <main className="flex-1 overflow-x-hidden">{children}</main>
      </div>
      <Toaster richColors position="top-right" />
    </body>
  </html>
);

export default RootLayout;
