import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { haySesion } from '@/panel/sesion';
import { FormularioPin } from './FormularioPin';

export const metadata = { title: 'Entrar' };

async function Puerta() {
  if (await haySesion()) redirect('/');
  return <FormularioPin />;
}

export default function Entrar() {
  return (
    <main className="entrar">
      <Suspense fallback={<div className="pagina" aria-busy="true" />}>
        <Puerta />
      </Suspense>
    </main>
  );
}
