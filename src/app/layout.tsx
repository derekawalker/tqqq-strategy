import type { Metadata } from "next";
import { MantineProvider, createTheme } from "@mantine/core";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

const theme = createTheme({
  defaultRadius: "xl",
  components: {
    Table: {
      defaultProps: {
        striped: true,
        highlightOnHover: true,
        stripedColor: "rgba(255,255,255,0.03)",
        highlightOnHoverColor: "rgba(255,255,255,0.05)",
        verticalSpacing: "sm",
        fz: "sm",
      },
    },
    Paper: {
      defaultProps: {
        shadow: "md",
      },
    },
    NumberInput:     { defaultProps: { radius: "sm" } },
    TextInput:       { defaultProps: { radius: "sm" } },
    Select:          { defaultProps: { radius: "sm" } },
    Textarea:        { defaultProps: { radius: "sm" } },
    DateInput:       { defaultProps: { radius: "sm" } },
    DatePickerInput: { defaultProps: { radius: "sm" } },
  },
});
import { Notifications } from "@mantine/notifications";
import { AppProvider } from "@/lib/context/AppContext";
import AppShellLayout from "@/components/AppShellLayout";
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "TQQQ Strategy",
  description: "Schwab account holdings tracker",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TQQQ",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1a1b1e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <MantineProvider theme={theme} forceColorScheme="dark">
          <AppProvider>
            <Notifications />
            <ServiceWorkerRegistration />
            <AppShellLayout>{children}</AppShellLayout>
          </AppProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
