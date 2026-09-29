import axios from 'axios';
import * as fs from 'fs';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export interface GeminiResult {
  objectType: string;
  brand: string;
  model: string;
  description: string;
  characteristics: Record<string, string>;
  confidence: number;
  alternatives: { name: string; confidence: number }[];
  rawAnalysis: string;
}

const PROMPT_STANDARD = (ocrText: string) => `Identifica este objeto físico con precisión.

${ocrText ? `TEXTO VISIBLE: "${ocrText}"` : ''}

Responde SOLO con JSON válido sin markdown ni texto adicional. El JSON debe ser completo y cerrado:
{
  "objectType": "tipo de objeto",
  "brand": "marca o Desconocida",
  "model": "modelo o No identificado",
  "description": "descripción breve en español máximo 80 caracteres",
  "confidence": 0,
  "characteristics": {
    "texto_visible": "texto que ves en la imagen",
    "color": "color principal",
    "tipo": "categoría específica"
  },
  "alternatives": [
    { "name": "alternativa", "confidence": 0 }
  ]
}

REGLAS: description máximo 80 caracteres. alternatives máximo 2 items. Confianza: 90+ si ves marca Y modelo. 70-89 si solo marca. 50-69 probable. Menos si incierto.`;

const PROMPT_ADVANCED = (ocrText: string) => `Eres un sistema experto de identificación de objetos físicos con visión avanzada.

${ocrText ? `TEXTO VISIBLE EN LA IMAGEN: "${ocrText}"` : ''}

INSTRUCCIONES:
1. Lee TODO el texto visible, incluso texto pequeño, números de serie, versiones
2. Distingue variantes específicas del mismo producto (ej: OC vs base)
3. Detecta números de modelo exactos aunque sean pequeños
4. Observa el estado físico (rayones, desgaste, modificaciones, daños)
5. Identifica accesorios o partes faltantes si es posible

Responde SOLO con JSON válido sin markdown ni texto adicional. El JSON debe ser completo y cerrado:
{
  "objectType": "tipo específico y detallado",
  "brand": "marca exacta",
  "model": "modelo completo con variante si es visible",
  "description": "descripción detallada incluyendo estado físico, máximo 120 caracteres",
  "confidence": 0,
  "characteristics": {
    "texto_visible": "todo el texto que puedes leer",
    "numero_modelo": "número de modelo si es visible",
    "numero_serie": "número de serie si es visible",
    "version": "versión específica si es identificable",
    "estado_fisico": "nuevo/usado/dañado y detalles",
    "color": "color principal",
    "tipo": "categoría específica"
  },
  "alternatives": [
    { "name": "alternativa con variante específica", "confidence": 0 }
  ]
}

REGLAS: description máximo 120 caracteres. alternatives máximo 2 items. Confianza: 90+ si ves marca Y modelo. 70-89 si solo marca. 50-69 probable.`;

// Intenta reparar un JSON cortado cerrando llaves/corchetes faltantes
function tryRepairJSON(raw: string): string {
  let text = raw.replace(/```json|```/g, '').trim();

  // Eliminar coma final antes de cierre
  text = text.replace(/,\s*([}\]])/g, '$1');

  // Contar aperturas y cierres
  const opens = (text.match(/\{/g) || []).length;
  const closes = (text.match(/\}/g) || []).length;
  const arrOpens = (text.match(/\[/g) || []).length;
  const arrCloses = (text.match(/\]/g) || []).length;

  // Cerrar strings abiertos si el último carácter no es un cierre
  const lastChar = text[text.length - 1];
  if (lastChar !== '}' && lastChar !== ']' && lastChar !== '"') {
    // Cortar en el último campo completo (antes de la última coma o cierre)
    const lastValidComma = text.lastIndexOf(',');
    const lastValidClose = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (lastValidClose > lastValidComma) {
      text = text.substring(0, lastValidClose + 1);
    } else if (lastValidComma > 0) {
      text = text.substring(0, lastValidComma);
    }
  }

  // Cerrar arrays y objetos faltantes
  for (let i = 0; i < arrOpens - arrCloses; i++) text += ']';
  for (let i = 0; i < opens - closes; i++) text += '}';

  return text;
}

async function callOpenAI(
  base64Image: string,
  prompt: string,
  model: string
): Promise<GeminiResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada');

  // Tokens aumentados: sol=1500, luna=1200
  const maxTokens = model === 'gpt-6-sol' ? 1500 : 1200;

  const response = await axios.post(
    OPENAI_URL,
    {
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: model === 'gpt-6-sol' ? 'high' : 'low',
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      max_completion_tokens: maxTokens,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 45000,
    }
  );

  const choice = response.data.choices[0];
  const rawText: string = choice.message.content || '';
  const finishReason: string = choice.finish_reason || '';

  console.log(`✅ ${model} respondió | finish_reason: ${finishReason} | tokens: ${rawText.length} chars`);

  // Advertir si se cortó por límite de tokens
  if (finishReason === 'length') {
    console.log(`⚠️ Respuesta cortada por max_tokens en ${model}, intentando reparar JSON...`);
  }

  let cleaned = rawText.replace(/```json|```/g, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (firstError) {
    console.log(`⚠️ JSON inválido, intentando reparar... (${(firstError as Error).message})`);
    try {
      const repaired = tryRepairJSON(cleaned);
      console.log(`🔧 JSON reparado: ${repaired.substring(0, 80)}...`);
      parsed = JSON.parse(repaired);
    } catch (secondError) {
      console.log(`❌ No se pudo reparar el JSON: ${(secondError as Error).message}`);
      console.log(`📄 Raw response (primeros 200 chars): ${rawText.substring(0, 200)}`);
      throw new Error(`JSON inválido de ${model}: ${(secondError as Error).message}`);
    }
  }

  return {
    objectType:      parsed.objectType      || 'Desconocido',
    brand:           parsed.brand           || 'Desconocida',
    model:           parsed.model           || 'No identificado',
    description:     parsed.description     || '',
    confidence:      parsed.confidence      || 0,
    characteristics: parsed.characteristics || {},
    alternatives:    parsed.alternatives    || [],
    rawAnalysis:     rawText,
  };
}

export async function analyzeImageWithGemini(
  imagePath: string,
  ocrText: string,
  scanMode: 'standard' | 'advanced' = 'standard'
): Promise<GeminiResult> {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  const model  = scanMode === 'advanced' ? 'gpt-6-sol' : 'gpt-6-luna';
  const prompt = scanMode === 'advanced' ? PROMPT_ADVANCED(ocrText) : PROMPT_STANDARD(ocrText);

  console.log(`🤖 Usando ${model} (modo ${scanMode})`);

  try {
    return await callOpenAI(base64Image, prompt, model);
  } catch (error: any) {
    const status = error.response?.status;
    const message = error.response?.data?.error?.message || error.message;
    console.log(`⚠️ ${model} error: ${status} — ${message}`);

    if (scanMode === 'advanced') {
      console.log('🔄 Fallback a gpt-6-luna...');
      try {
        return await callOpenAI(base64Image, PROMPT_STANDARD(ocrText), 'gpt-6-luna');
      } catch (fallbackError: any) {
        const fbMessage = fallbackError.response?.data?.error?.message || fallbackError.message;
        throw new Error(`Error de IA (fallback): ${fbMessage}`);
      }
    }

    throw new Error(`Error de IA: ${message}`);
  }
}

export async function analyzeContextWithGemini(
  objectType: string,
  brand: string,
  model: string,
  description: string,
  characteristics: Record<string, string>
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return '';

  const prompt = `Eres un asistente experto que analiza objetos físicos y proporciona insights inteligentes.

OBJETO IDENTIFICADO:
- Tipo: ${objectType}
- Marca: ${brand}
- Modelo: ${model}
- Descripción: ${description}
- Características observadas: ${JSON.stringify(characteristics)}

Proporciona un ANÁLISIS CONTEXTUAL inteligente en español que incluya:
1. USO PROBABLE: ¿Para qué sirve exactamente? ¿A quién va dirigido?
2. DEDUCCIONES VISUALES: ¿Qué puedes inferir del estado, contexto o uso del objeto?
3. DATOS ÚTILES: Información relevante que el usuario debería conocer
4. ESTADO FÍSICO: Observa si parece nuevo, usado, dañado o incompleto
5. ADVERTENCIA si aplica

Escribe máximo 3 oraciones en párrafo natural. Responde SOLO con el texto del análisis, sin JSON.`;

  try {
    const response = await axios.post(
      OPENAI_URL,
      {
        model: 'gpt-6-luna',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 400,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    const text = response.data.choices[0].message.content;
    console.log('🧠 Análisis contextual generado');
    return text.trim();
  } catch (e: any) {
    console.log('⚠️ Análisis contextual error:', e.message);
    return '';
  }
}