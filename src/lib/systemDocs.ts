import capacidades from '../documentos_osone/capacidades.md?raw';
import manifesto from '../documentos_osone/manifesto.md?raw';
import memoriaEvolutiva from '../documentos_osone/memoria_evolutiva.md?raw';

const SYSTEM_DOCUMENTS: Record<string, string> = {
  'capacidades.md': capacidades,
  'manifesto.md': manifesto,
  'memoria_evolutiva.md': memoriaEvolutiva
};

export const getSystemDocument = (requestedName: unknown): string => {
  const fileName = String(requestedName || 'manifesto.md')
    .trim()
    .toLowerCase()
    .split(/[\\/]/)
    .pop() || 'manifesto.md';

  const document = SYSTEM_DOCUMENTS[fileName];
  if (!document) {
    throw new Error(
      `Documento interno "${fileName}" não encontrado. Disponíveis: ${Object.keys(SYSTEM_DOCUMENTS).join(', ')}.`
    );
  }
  return document;
};
