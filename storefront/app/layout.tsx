import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://repo.jimwashkau.com"),
  title: {
    default: "JimWas Repo — Independent iOS Tweaks",
    template: "%s | JimWas Repo",
  },
  description: "Explore free and paid iOS tweaks from JimWas Repo. Discover JimWas Recorder and add the repo to Sileo or Zebra.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "JimWas Repo",
    title: "JimWas Repo — Independent iOS Tweaks",
    description: "Explore free and paid iOS tweaks from JimWas Repo. Discover JimWas Recorder and add the repo to Sileo or Zebra.",
    url: "/",
    images: [{
      url: "/images/jimwas-recorder-banner-compatibility.png",
      width: 1672,
      height: 941,
      alt: "JimWas Recorder product preview",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "JimWas Repo — Independent iOS Tweaks",
    description: "Explore free and paid iOS tweaks from JimWas Repo, including JimWas Recorder.",
    images: ["/images/jimwas-recorder-banner-compatibility.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
