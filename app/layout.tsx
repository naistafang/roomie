import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roomie",
  description: "Private property and booking calendar",
  applicationName: "Roomie",
  appleWebApp: { capable: true, title: "Roomie", statusBarStyle: "default" },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "https://roomie-icon-miru.myla0319.chatgpt.site/roomie-icon.png",
    apple: [{ url: "https://roomie-icon-miru.myla0319.chatgpt.site/roomie-icon.png", sizes: "512x512", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const assetRecoveryScript = `(() => {
    const key = "roomie-last-asset-recovery";
    const recover = () => {
      const now = Date.now();
      const last = Number(sessionStorage.getItem(key) || 0);
      if (now - last < 300000) return;
      sessionStorage.setItem(key, String(now));
      const url = new URL(window.location.href);
      url.searchParams.set("roomie_refresh", String(now));
      window.location.replace(url.toString());
    };
    window.addEventListener("error", (event) => {
      const target = event.target;
      if (target instanceof HTMLScriptElement && target.src.includes("/assets/")) recover();
    }, true);
    window.addEventListener("unhandledrejection", (event) => {
      const message = String(event.reason?.message || event.reason || "");
      if (/dynamically imported module|module script|chunk/i.test(message)) recover();
    });
  })();`;

  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <script dangerouslySetInnerHTML={{ __html: assetRecoveryScript }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
