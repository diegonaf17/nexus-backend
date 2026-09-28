import axios from 'axios';
import * as fs from 'fs';

const MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
];

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

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
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const url = `${BASE_URL}/${modelName}:generateContent?key=${apiKey}`;

  const prompt = `Identifica este objeto físico con precisión.

${ocrText ? `TEXTO VISIBLE: "${ocrText}"` : ''}

Responde SOLO con JSON:
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
    url,
    {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: base64Image,
              },
            },
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    },
    { timeout: 30000 }
  );

  const rawText = response.data.candidates[0].content.parts[0].text;
  console.log(`✅ Modelo ${modelName} respondió correctamente`);

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
      if (status !== 404 && status !== 503 && status !== 429 && status !== 400) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (status !== 404 && status !== 503 && status !== 429 && status !== 400) {
        throw error;
      }
    }
  }

  throw new Error('Ningún modelo de Gemini está disponible. Verifica tu API key.');
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

Proporciona un ANÁLISIS CONTEXTUAL inteligente en español que incluya según corresponda:

1. USO PROBABLE: ¿Para qué sirve exactamente? ¿A quién va dirigido?
2. DEDUCCIONES VISUALES: ¿Qué puedes inferir del estado, contexto o uso del objeto?
3. DATOS ÚTILES: Información relevante que el usuario debería conocer
4. ADVERTENCIA si aplica (medicamento, producto peligroso, estado deteriorado, etc.)
5. ESTADO FÍSICO: Observa si el objeto parece nuevo, usado, dañado, sucio, incompleto o modificado. Menciona cualquier detalle visual que sugiera el estado actual del objeto.

Ejemplos de buenas deducciones:
- Pelota pequeña colorida → "Por su tamaño y material blando, es compatible con juguetes para mascotas pequeñas. También podría usarse como pelota antiestrés."
- Caja de pastillas abierta → "El empaque se encuentra abierto, lo que sugiere uso previo. Verifica la fecha de vencimiento antes de consumir."
- GPU de gama alta → "Orientada a gaming en resoluciones 1440p o 4K. Su consumo energético requiere una fuente de poder de al menos 650W."

Sé específico, inteligente y útil. No repitas datos ya conocidos del objeto.
Escribe máximo 3 oraciones en párrafo natural, sin títulos ni listas.
Responde SOLO con el texto del análisis.`;

  for (const modelName of MODELS) {
    try {
      const url = `${BASE_URL}/${modelName}:generateContent?key=${apiKey}`;
      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 300,
          },
        },
        { timeout: 15000 }
      );

      const text = response.data.candidates[0].content.parts[0].text;
      console.log('🧠 Análisis contextual generado');
      return text.trim();

    } catch (e: any) {
      const status = e.response?.status;
      const msg = e.response?.data?.error?.message || e.message;
      console.log(`⚠️ Análisis contextual error: ${status} — ${msg}`);
      if (status === 503 || status === 429) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (status !== 404 && status !== 503) return '';
    }
  }

  return '';
}