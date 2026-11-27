import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Observer.to",
  description:
    "Observer.to records public Wi-Fi and Bluetooth presence around a place you are responsible for. The Mac app is free and can apply a security checklist on that Mac. Five dollars a month emails a weekly review and an immediate alert when a site finding is critical.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
