import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://observer.to"),
  title: "Observer.to",
  description:
    "Observer.to records public Wi-Fi and Bluetooth presence around a place you are responsible for. The Mac app is free and can apply a security checklist on that Mac. Five dollars a month emails a weekly review and an immediate alert when a site finding is critical.",
  openGraph: {
    images: [
      {
        url: "/demo/harbor-map.jpg",
        width: 1024,
        height: 559,
        alt: "Observer.to demo on the Map tab, showing the Harbor Annex walk on a street map with Harbor Guest, the lobby beacon, Annex IoT, Harbor Annex, the serving tower, and this device.",
      },
    ],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
