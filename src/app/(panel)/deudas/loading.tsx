import { Esqueleto } from '@/components/ui';

export default function Cargando() {
  return (
    <div className="pagina" aria-busy="true" aria-label="Cargando" role="status">
      <Esqueleto forma="cifra" ancho="55%" alto="clamp(3rem, 9vw, 5rem)" />
      <div style={{ marginTop: 'var(--e-6)', display: 'grid', gap: 'var(--e-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
        <Esqueleto alto={140} />
        <Esqueleto alto={140} />
        <Esqueleto alto={140} />
      </div>
      <div style={{ marginTop: 'var(--e-6)' }}><Esqueleto forma="texto" lineas={4} /></div>
    </div>
  );
}
