import axios from 'axios';
import * as fs from 'fs';

const MODELS = [
  'google/gemini-2.5-flash-lite:free',
  'google/gemini-2.5-flash:free',
  'google/gemini-flash-1.5:free',
  'meta-llama/llama-3.2-11b-vision-instruct:free',
];

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

async function tryModel(modelName: string, base64Image: string, ocrText: string): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('API key no configurada');

  const prompt = `Identifica este objeto físico con precisión.

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

  const response = await axios.post(
    OPENROUTER_URL,
    {
      model: modelName,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.2,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nexus-scanner.app',
        'X-Title': 'NEXUS Scanner',
      },
      timeout: 30000,
    }
  );

  const rawText = response.data.choices[0].message.content;
  console.log(`✅ Modelo ${modelName} respondió`);

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

export async function analyzeImageWithGemini(imagePath: string, ocrText: string): Promise<GeminiResult> {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  for (const modelName of MODELS) {
    try {
      console.log(`🔄 Intentando con ${modelName}...`);
      const result = await tryModel(modelName, base64Image, ocrText);
      return result;
    } catch (error: any) {
      const status = error.response?.status;
      const message = error.response?.data?.error?.message || error.message;
      console.log(`⚠️  ${modelName} → status ${status}: ${message}`);
      if (status === 503 || status === 429) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (status !== 404 && status !== 503 && status !== 429 && status !== 400) {
        throw error;
      }
    }
  }

  throw new Error('Ningún modelo disponible en este momento');
}

export async function analyzeContextWithGemini(
  objectType: string,
  brand: string,
  model: string,
  description: string,
  characteristics: Record<string, string>
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
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
      OPENROUTER_URL,
      {
        model: 'google/gemini-2.5-flash-lite:free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.4,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://nexus-scanner.app',
          'X-Title': 'NEXUS Scanner',
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