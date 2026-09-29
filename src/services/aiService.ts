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

// ─── LUNA: Observador confiado, concluye con criterio, eficiente ───────────────
const PROMPT_STANDARD = (ocrText: string) => `Eres un analizador visual de objetos físicos. Observas, identificas y concluyes con confianza basándote en lo que ves claramente.

${ocrText ? `TEXTO VISIBLE EN LA IMAGEN: "${ocrText}"` : ''}

INSTRUCCIONES:
- Identifica marca, modelo y tipo de objeto
- Si no ves marca con texto claro, identifica por diseño, forma, distribución de botones o estilo visual. Usa "Similar a [marca conocida]" si el diseño es reconocible
- Describe el estado físico visible: vacío, lleno, roto, sucio, desgastado, nuevo
- Concluye lo que el estado implica: "la botella está vacía, lo que indica que su contenido fue consumido", "el dispositivo muestra polvo acumulado, sugiere poco uso reciente", "la esquina presenta fractura por impacto"
- Sé directo y útil. Nunca escribas "no hay suficiente información" ni "no se puede determinar"

Responde SOLO con JSON válido sin markdown ni texto adicional:
{
  "objectType": "tipo de objeto específico",
  "brand": "marca exacta, Similar a [marca] si identificas por diseño, o Desconocida solo si no hay referencia posible",
  "model": "modelo exacto, Similar a [modelo] si es inferido, o No identificado",
  "description": "estado físico y conclusión directa, máximo 100 caracteres",
  "confidence": 0,
  "characteristics": {
    "estado_fisico": "descripción del estado visible y lo que implica",
    "color": "color principal",
    "tipo": "categoría específica",
    "texto_visible": "todo texto legible o Ninguno"
  },
  "alternatives": [
    { "name": "posible alternativa", "confidence": 0 }
  ]
}

REGLAS: description máximo 100 caracteres. alternatives máximo 2 items. Confianza: 90+ marca Y modelo visibles con texto. 70-89 marca visible o diseño muy reconocible. 50-69 inferido por similitud. Menos si realmente incierto.`;

// ─── SOL: Perito forense, razona en capas, detecta detalles finos ──────────────
const PROMPT_ADVANCED = (ocrText: string) => `Eres un sistema de análisis forense visual de objetos físicos. Tu función es identificar con precisión máxima, razonar sobre lo que observas y emitir diagnósticos accionables.

${ocrText ? `TEXTO VISIBLE EN LA IMAGEN: "${ocrText}"` : ''}

PROCESO DE ANÁLISIS:
1. LEE todo texto visible: etiquetas, números de modelo, serie, versiones, stickers, códigos
2. IDENTIFICA marca y modelo exacto; si no hay marca visible, busca similitudes por forma, materiales, distribución de elementos, tipo de conexiones o estilo de diseño. Referencia productos conocidos
3. EVALÚA el estado físico en detalle: localiza zonas específicas de desgaste, tipo exacto de daño (fractura, abrasión, corrosión, quemadura), severidad, componentes faltantes o desplazados
4. RAZONA sobre implicaciones reales: qué causó el daño visible, qué riesgos implica, qué acciones concretas se recomiendan
5. DETECTA detalles técnicos: tipo de conexiones, materiales, generación del producto, partes visibles relevantes

Responde SOLO con JSON válido sin markdown ni texto adicional:
{
  "objectType": "tipo específico y detallado",
  "brand": "marca exacta o Similar a [referencia conocida]",
  "model": "modelo completo con variante y generación, o Similar a [modelo conocido]",
  "description": "diagnóstico directo: qué es, qué estado tiene y qué implica. Máximo 140 caracteres",
  "confidence": 0,
  "characteristics": {
    "texto_visible": "todo el texto legible o Ninguno",
    "numero_modelo": "número de modelo si es visible o No visible",
    "version_generacion": "versión o generación identificable o No determinada",
    "estado_fisico": "zona afectada + tipo de daño + severidad estimada",
    "implicaciones": "causa probable del daño y recomendación accionable",
    "conexiones_componentes": "puertos, materiales o partes visibles relevantes",
    "color": "color principal"
  },
  "alternatives": [
    { "name": "alternativa específica con variante", "confidence": 0 }
  ]
}

REGLAS: description máximo 140 caracteres. alternatives máximo 2 items. Nunca respondas "No determinado" sin antes intentar inferir por similitud visual. Confianza: 90+ marca Y modelo claros con texto. 70-89 solo marca visible. 50-69 inferido por diseño/similitud.`;

// ─── Reparador de JSON cortado ─────────────────────────────────────────────────
function tryRepairJSON(raw: string): string {
  let text = raw.replace(/```json|```/g, '').trim();
  text = text.replace(/,\s*([}\]])/g, '$1');

  const opens     = (text.match(/\{/g) || []).length;
  const closes    = (text.match(/\}/g) || []).length;
  const arrOpens  = (text.match(/\[/g) || []).length;
  const arrCloses = (text.match(/\]/g) || []).length;

  const lastChar = text[text.length - 1];
  if (lastChar !== '}' && lastChar !== ']' && lastChar !== '"') {
    const lastValidComma = text.lastIndexOf(',');
    const lastValidClose = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (lastValidClose > lastValidComma) {
      text = text.substring(0, lastValidClose + 1);
    } else if (lastValidComma > 0) {
      text = text.substring(0, lastValidComma);
    }
  }

  for (let i = 0; i < arrOpens - arrCloses; i++) text += ']';
  for (let i = 0; i < opens - closes; i++) text += '}';

  return text;
}

// ─── Llamada a OpenAI ──────────────────────────────────────────────────────────
async function callOpenAI(
  base64Image: string,
  prompt: string,
  model: string
): Promise<GeminiResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada');

  // Luna: detail:low — el frontend ya le manda 640px, suficiente para logos y diseños
  // Sol:  detail:high — recibe 800px + resolución alta para análisis forense completo
  const isSOL      = model === 'gpt-6-sol';
  const maxTokens  = isSOL ? 1400 : 1000;
  const detailMode = isSOL ? 'high' : 'low';

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
                detail: detailMode,
              },
            },
            { type: 'text', text: prompt },
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
      timeout: 30000,
    }
  );

  const choice       = response.data.choices[0];
  const rawText: string   = choice.message.content || '';
  const finishReason: string  = choice.finish_reason || '';

  console.log(`✅ ${model} | finish: ${finishReason} | chars: ${rawText.length}`);

  if (finishReason === 'length') {
    console.log(`⚠️ JSON cortado por max_tokens en ${model}, reparando...`);
  }

  const cleaned = rawText.replace(/```json|```/g, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    try {
      parsed = JSON.parse(tryRepairJSON(cleaned));
      console.log(`🔧 JSON reparado exitosamente`);
    } catch (e2) {
      console.log(`❌ JSON irreparable. Raw (200): ${rawText.substring(0, 200)}`);
      throw new Error(`JSON inválido de ${model}: ${(e2 as Error).message}`);
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

// ─── Análisis visual principal ─────────────────────────────────────────────────
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
    const status  = error.response?.status;
    const message = error.response?.data?.error?.message || error.message;
    console.log(`⚠️ ${model} error: ${status} — ${message}`);

    if (scanMode === 'advanced') {
      console.log('🔄 Fallback a gpt-6-luna...');
      try {
        return await callOpenAI(base64Image, PROMPT_STANDARD(ocrText), 'gpt-6-luna');
      } catch (fb: any) {
        throw new Error(`Error de IA (fallback): ${fb.response?.data?.error?.message || fb.message}`);
      }
    }

    throw new Error(`Error de IA: ${message}`);
  }
}

// ─── Análisis contextual (tercera llamada) ─────────────────────────────────────
// Recibe el resultado completo para razonar sobre lo que ya se detectó visualmente
export async function analyzeContextWithGemini(
  objectType: string,
  brand: string,
  model: string,
  description: string,
  characteristics: Record<string, string>
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return '';

  // Extraer campos clave para dar al modelo contexto rico sin tokens extra
  const estadoFisico  = characteristics['estado_fisico']         || '';
  const implicaciones = characteristics['implicaciones']          || '';
  const conexiones    = characteristics['conexiones_componentes'] || '';
  const textoVisible  = characteristics['texto_visible']          || '';

  const prompt = `Eres un analista experto en objetos físicos. Se te entrega el resultado de un análisis visual ya realizado. Tu tarea es escribir una conclusión inteligente y accionable basada en los datos reales observados, no en suposiciones genéricas.

DATOS DEL ANÁLISIS VISUAL:
- Objeto: ${objectType}
- Marca: ${brand}
- Modelo: ${model}
- Descripción detectada: ${description}
${estadoFisico  ? `- Estado físico observado: ${estadoFisico}`  : ''}
${implicaciones ? `- Implicaciones detectadas: ${implicaciones}` : ''}
${conexiones    ? `- Componentes/conexiones: ${conexiones}`      : ''}
${textoVisible  ? `- Texto visible: ${textoVisible}`             : ''}

INSTRUCCIONES:
- Escribe 2-3 oraciones en español, párrafo natural, sin listas
- Basa tu análisis SOLO en los datos reales de arriba, no inventes información
- Si hay estado físico relevante, úsalo para dar una recomendación concreta
- Si el objeto representa un riesgo o requiere atención, indícalo claramente
- No repitas lo que ya se ve en descripción, añade valor con tu razonamiento
- Responde SOLO con el texto del análisis, sin JSON ni títulos`;

  try {
    const response = await axios.post(
      OPENAI_URL,
      {
        model: 'gpt-6-luna',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 280,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 18000,
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