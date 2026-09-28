import axios from 'axios';

export interface WikiResult {
  found: boolean;
  title: string;
  summary: string;
  url: string;
}

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];

export async function searchWikipedia(query: string): Promise<WikiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { found: false, title: '', summary: '', url: '' };

  const prompt = `Eres una base de datos de productos. Proporciona información sobre: "${query}"

IMPORTANTE: Siempre responde con información aunque sea general sobre la marca o categoría del producto.

Responde SOLO con este JSON exacto:
{
  "found": true,
  "title": "nombre completo del producto",
  "summary": "Descripción en español de 2-3 oraciones sobre este producto o marca. Incluye: qué es, para qué sirve, características destacadas, y cualquier dato relevante como año de lanzamiento, especificaciones clave, o posición en el mercado.",
  "url": "sitio web oficial del fabricante"
}

Responde SOLO con el JSON, sin markdown ni texto adicional.`;

  for (const model of MODELS) {
    try {
      const url = `${BASE_URL}/${model}:generateContent?key=${apiKey}`;
      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 512,
          },
        },
        { timeout: 15000 }
      );

      const rawText = response.data.candidates[0].content.parts[0].text;
      console.log('📖 Respuesta info adicional:', rawText.substring(0, 100));
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        found:   true,
        title:   parsed.title   || query,
        summary: parsed.summary || '',
        url:     parsed.url     || '',
      };

    } catch (e: any) {
      const status = e.response?.status;
      console.log(`⚠️ Info adicional error: ${status}`);
      if (status !== 404 && status !== 503) {
        return { found: false, title: '', summary: '', url: '' };
      }
    }
  }

  return { found: false, title: '', summary: '', url: '' };
}