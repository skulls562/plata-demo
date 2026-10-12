/** Une nombres de clase ignorando valores vacíos. */
export function cx(...partes: (string | false | null | undefined)[]): string {
  return partes.filter(Boolean).join(' ');
}
