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

Responde SOLO con JSON válido sin markdown:
{
  "objectType": "tipo de objeto",
  "brand": "marca o 'Desconocida'",
  "model": "modelo o 'No identificado'",
  "description": "descripción breve en español",
  "confidence": número 0-100,
  "characteristics": {
    "texto_visible": "texto que ves en la imagen",
    "color": "color principal",
    "tipo": "categoría específica"
  },
  "alternatives": [
    { "name": "alternativa", "confidence": número }
  ]
}

Confianza: 90+ si ves marca Y modelo claramente. 70-89 si solo marca. 50-69 si es probable. Menos si es incierto.`;

const PROMPT_ADVANCED = (ocrText: string) => `Eres un sistema experto de identificación de objetos físicos con visión avanzada.

${ocrText ? `TEXTO VISIBLE EN LA IMAGEN: "${ocrText}"` : ''}

INSTRUCCIONES AVANZADAS:
1. Lee TODO el texto visible, incluso texto pequeño, números de serie, versiones
2. Distingue entre variantes específicas del mismo producto (ej: OC vs base, versión A vs B)
3. Detecta números de modelo exactos aunque sean pequeños
4. Observa el estado físico detalladamente (rayones, desgaste, modificaciones, daños)
5. Identifica accesorios, componentes o partes faltantes si es posible
6. Lee etiquetas, stickers, códigos si son visibles

Responde SOLO con JSON válido sin markdown:
{
  "objectType": "tipo específico y detallado",
  "brand": "marca exacta",
  "model": "modelo completo con variante si es visible",
  "description": "descripción detallada en español incluyendo estado físico",
  "confidence": número 0-100,
  "characteristics": {
    "texto_visible": "TODO el texto que puedes leer",
    "numero_modelo": "número de modelo si es visible",
    "numero_serie": "número de serie si es visible",
    "version": "versión específica si es identificable",
    "estado_fisico": "nuevo/usado/dañado y detalles",
    "color": "color principal",
    "tipo": "categoría específica"
  },
  "alternatives": [
    { "name": "alternativa con variante específica", "confidence": número }
  ]
}

Confianza: 90+ si ves marca Y modelo claramente. 70-89 si solo marca. 50-69 si es probable.`;

async function callOpenAI(
  base64Image: string,
  prompt: string,
  model: string
): Promise<GeminiResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada');

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
      max_completion_tokens: model === 'gpt-6-sol' ? 800 : 500,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 40000,
    }
  );

  const rawText = response.data.choices[0].message.content;
  console.log(`✅ ${model} respondió correctamente`);

  const cleaned = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

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
      return await callOpenAI(base64Image, PROMPT_STANDARD(ocrText), 'gpt-6-luna');
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

Escribe máximo 3 oraciones en párrafo natural. Responde SOLO con el texto del análisis.`;

  try {
    const response = await axios.post(
      OPENAI_URL,
      {
        model: 'gpt-6-luna',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 300,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
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