import { GeminiResult } from './aiService';
import { WikiResult } from './wikipediaService';

export interface ConfidenceResult {
  score: number;
  level: 'IDENTIFICADO' | 'ALTA CONFIANZA' | 'POSIBLE COINCIDENCIA' | 'INCIERTO' | 'NO IDENTIFICADO';
  color: string;
  message: string;
  needsMoreInfo: boolean;
  suggestions: string[];
}

export function calculateConfidence(
  gemini: GeminiResult,
  wiki: WikiResult,
  ocrTextCount: number
): ConfidenceResult {

  const brand = gemini.brand || '';
  const model = gemini.model || '';

  // Evaluar qué tan bien se identificó el objeto
  const brandKnown =
    brand !== '' &&
    brand.toLowerCase() !== 'desconocida' &&
    brand.toLowerCase() !== 'unknown';

  const modelKnown =
    model !== '' &&
    model.toLowerCase() !== 'no identificado' &&
    model.toLowerCase() !== 'not identified';

  const isSimilar =
    brand.toLowerCase().includes('similar') ||
    model.toLowerCase().includes('similar');

  // ── Calcular score base desde los datos reales identificados ──────────────────
  // No confiamos ciegamente en el número que Sol devuelve, porque a veces
  // reporta 1% aunque haya identificado correctamente marca y modelo.
  // Tomamos el MÁXIMO entre el score de Sol y el score que calculamos aquí.
  let baseScore: number;

  if (brandKnown && modelKnown && !isSimilar) {
    baseScore = 82; // Marca Y modelo claramente identificados
  } else if (brandKnown && modelKnown && isSimilar) {
    baseScore = 63; // Identificado por similitud visual
  } else if (brandKnown && !modelKnown) {
    baseScore = 58; // Solo marca identificada
  } else if (!brandKnown && modelKnown) {
    baseScore = 52; // Solo modelo identificado
  } else {
    baseScore = 15; // Nada identificado con certeza
  }

  // Usar el mayor entre el score de Sol y el calculado
  let score = Math.max(gemini.confidence || 0, baseScore);

  // ── Bonificaciones adicionales ─────────────────────────────────────────────────
  if (wiki.found)       score = Math.min(100, score + 5);
  if (ocrTextCount > 3) score = Math.min(100, score + 8);
  else if (ocrTextCount > 0) score = Math.min(100, score + 3);

  score = Math.round(score);

  // ── Nivel y color según score final ───────────────────────────────────────────
  let level: ConfidenceResult['level'];
  let color: string;
  let message: string;
  let needsMoreInfo = false;
  let suggestions: string[] = [];

  if (score >= 85) {
    level   = 'IDENTIFICADO';
    color   = '#00ff88';
    message = 'Objeto identificado con alta precisión';
  } else if (score >= 65) {
    level   = 'ALTA CONFIANZA';
    color   = '#ffcc00';
    message = 'Identificación probable con buena confianza';
  } else if (score >= 45) {
    level   = 'POSIBLE COINCIDENCIA';
    color   = '#ff8c00';
    message = 'Se detectaron coincidencias parciales';
    needsMoreInfo = true;
    suggestions = [
      'Acerca la cámara a la etiqueta',
      'Enfoca el logo de la marca',
      'Intenta con mejor iluminación',
    ];
  } else if (score >= 25) {
    level   = 'INCIERTO';
    color   = '#ff3c3c';
    message = 'Identificación con baja confianza';
    needsMoreInfo = true;
    suggestions = [
      'Muestra el código de barras si hay uno',
      'Acerca más la cámara al objeto',
      'Muestra la parte trasera del objeto',
    ];
  } else {
    level   = 'NO IDENTIFICADO';
    color   = '#ff0000';
    message = 'No se pudo identificar el objeto';
    needsMoreInfo = true;
    suggestions = [
      'Asegúrate de que el objeto esté bien iluminado',
      'Centra el objeto en la retícula',
      'Muestra la etiqueta o código de barras',
    ];
  }

  return { score, level, color, message, needsMoreInfo, suggestions };
}
