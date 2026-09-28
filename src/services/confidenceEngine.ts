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

  // El score ES el de Gemini directamente
  let score = gemini.confidence;

  // Bonus pequeño si hay info adicional verificada
  if (wiki.found) score = Math.min(100, score + 3);

  // Bonus si OCR detectó texto
  if (ocrTextCount > 0) score = Math.min(100, score + 2);

  score = Math.round(score);

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