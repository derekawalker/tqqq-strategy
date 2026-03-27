import type { Metadata } from "next";
import { MantineProvider, createTheme } from "@mantine/core";

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
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
<body>
        <MantineProvider theme={theme} forceColorScheme="dark">
          <AppProvider>
            <Notifications />
            <AppShellLayout>{children}</AppShellLayout>
          </AppProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
