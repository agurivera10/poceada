import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Poceada Lab",
  description: "Laboratorio auditable de datos, modelos, carteras y resultados de la Poceada Correntina.",
};

const nav = [
  ["/", "Resumen"],
  ["/datos", "Datos"],
  ["/auditoria", "Auditoría"],
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <header className="header">
          <div className="shell header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" />
              <span>POCEADA LAB</span>
            </Link>
            <nav className="nav" aria-label="Navegación principal">
              {nav.map(([href, label]) => (
                <Link key={href} href={href}>{label}</Link>
              ))}
            </nav>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div className="shell">
            DATA‑V1 · análisis experimental y auditable. Las métricas históricas no garantizan resultados futuros.
          </div>
        </footer>
      </body>
    </html>
  );
}
