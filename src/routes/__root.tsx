import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { ThemeProvider } from "@/components/theme-provider";
import { AppQueryProvider } from "@/components/data-provider";
import { InstallProvider } from "@/hooks/use-install-app";
import { PwaSplash } from "@/components/pwa-splash";
import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";

const APP_NAME = "FinanceOS";

const SPLASH = [
  { w: 430, h: 932, dpr: 3, file: "1290x2796" },
  { w: 393, h: 852, dpr: 3, file: "1179x2556" },
  { w: 390, h: 844, dpr: 3, file: "1170x2532" },
  { w: 428, h: 926, dpr: 3, file: "1284x2778" },
  { w: 414, h: 896, dpr: 3, file: "1242x2688" },
  { w: 414, h: 896, dpr: 2, file: "828x1792" },
  { w: 375, h: 667, dpr: 2, file: "750x1334" },
  { w: 744, h: 1133, dpr: 2, file: "1488x2266" },
  { w: 834, h: 1194, dpr: 2, file: "1668x2388" },
  { w: 1024, h: 1366, dpr: 2, file: "2048x2732" },
] as const;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "application-name", content: APP_NAME },
      { name: "theme-color", content: "#0c0c0d" },
      { name: "description", content: "Personal finance and trip operating system." },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Outfit:wght@400;500;600&display=swap",
      },
      ...SPLASH.map((s) => ({
        rel: "apple-touch-startup-image" as const,
        href: `/splash/${s.file}.png`,
        media: `screen and (device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`,
      })),
    ],
  }),
  component: Root,
});

function Root() {
  return (
    <html lang="en" className="dark antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <ThemeProvider>
          <AppQueryProvider>
            <AuthProvider>
              <InstallProvider>
                <PwaSplash />
                <Outlet />
                <Toaster />
              </InstallProvider>
            </AuthProvider>
          </AppQueryProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
