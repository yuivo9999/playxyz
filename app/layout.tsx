import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D Virtual Cinema Experience",
  description: "Interactive 3D Virtual Auditorium & Seat Booking System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
