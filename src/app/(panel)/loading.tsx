export default function Cargando() {
  return (
    <div className="pagina" aria-busy="true" aria-label="Cargando" role="status">
      <div className="esqueleto carga-titulo" />
      <div className="reticula reticula-3 carga-rejilla">
        <div className="carga-celda" /><div className="carga-celda" /><div className="carga-celda" />
      </div>
    </div>
  );
}
