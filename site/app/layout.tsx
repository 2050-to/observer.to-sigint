import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Observer.to",
  description:
    "Observer.to records public Wi-Fi and Bluetooth presence around a place you are responsible for. The Mac app is free. Five dollars a month emails a weekly review of vulnerabilities and patch guidance.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
