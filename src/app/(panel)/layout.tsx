import { AvisoInstalar } from '@/components/AvisoInstalar';
import { GuiaPlata } from '@/components/guia/GuiaPlata';
import { Sidebar } from '@/components/Sidebar';

// Marco del panel: menú lateral fijo en escritorio (barra inferior en celular) y el contenido a su lado.
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marco">
      <a href="#contenido" className="saltar">Saltar al contenido</a>
      <Sidebar />
      <main id="contenido" className="marco-contenido">
        <AvisoInstalar />
        {children}
      </main>
      <GuiaPlata />
    </div>
  );
}
