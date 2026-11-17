import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Bricolage_Grotesque({ subsets: ["latin"], variable: "--sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--mono" });

export const metadata = { title: "FOGÃO CUT!", description: "Recorte trechos de vídeos do YouTube em MP4." };

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body className={`${sans.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
