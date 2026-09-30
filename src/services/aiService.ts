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
  urgencyLevel: 'SEGURO' | 'REVISAR' | 'ATENCIÓN' | 'PELIGRO';
  urgencyReason: string;
  chemicalWarning: string;
  rawAnalysis: string;
}

export interface LunaSpecs {
  contextAnalysis: string;
  chemicalAnalysis: string;
  riskAssessment: string;
  recommendations: string;
}

// ─── FASE 0: Detección de nivel de detalle necesario (llamada ultrabarata) ─────
const PROMPT_DETAIL_CHECK = `Eres un clasificador rápido de imágenes. Tu ÚNICA tarea es decidir si esta imagen necesita análisis de alta resolución o baja resolución.

Responde SOLO con este JSON sin markdown:
{
  "needsHighDetail": true,
  "reason": "motivo en 5 palabras máximo"
}

needsHighDetail = true si: hay texto pequeño, logos, números de modelo, placas técnicas, chips, circuitos, etiquetas con información, texto en envases, códigos, o el objeto es pequeño y tiene detalles finos.
needsHighDetail = false si: el objeto es grande y obvio (mueble, ropa, botella sin etiqueta visible, escombros, comida genérica, objetos naturales).`;

// ─── SOL: Perito forense visual — identifica, diagnostica, detecta riesgos ─────
const PROMPT_SOL = (ocrText: string) => `Eres un sistema de análisis forense visual de objetos físicos con capacidad de detección de riesgos químicos y físicos. Analizas con precisión máxima y emites diagnósticos accionables.

${ocrText ? `TEXTO VISIBLE EN LA IMAGEN: "${ocrText}"` : ''}

PROCESO DE ANÁLISIS EN CAPAS:
1. LEE todo texto visible: etiquetas, números de modelo, serie, versiones, ingredientes, advertencias, códigos
2. IDENTIFICA marca y modelo exacto. Si no hay marca visible, busca similitudes por forma, materiales, distribución de elementos, tipo de conexiones o estilo de diseño
3. EVALÚA el estado físico zona por zona: desgaste específico por área, tipo exacto de daño (fractura, abrasión, corrosión, quemadura, abolladura), severidad, componentes faltantes
4. ANALIZA el entorno visible: humedad, suciedad ambiental, contexto de riesgo, señales de mal almacenamiento
5. DETECTA composición probable: si es alimento, producto químico, humo, polvo, gas, material industrial o doméstico — identifica compuestos probables y riesgos asociados
6. EVALÚA nivel de urgencia basado en lo observado

Responde SOLO con JSON válido sin markdown:
{
  "objectType": "tipo específico y detallado",
  "brand": "marca exacta o Similar a [referencia conocida]",
  "model": "modelo completo con variante y generación, o Similar a [modelo conocido]",
  "description": "diagnóstico directo: qué es, estado y qué implica. Máximo 140 caracteres",
  "confidence": 0,
  "characteristics": {
    "texto_visible": "todo el texto legible o Ninguno",
    "numero_modelo": "número de modelo si visible o No visible",
    "version_generacion": "versión o generación identificable o No determinada",
    "estado_fisico": "zona afectada + tipo de daño + severidad + qué lo causó probablemente",
    "entorno_visible": "descripción del contexto ambiental visible alrededor del objeto",
    "implicaciones": "consecuencias del estado observado y recomendación accionable",
    "conexiones_componentes": "puertos, materiales, partes visibles relevantes o No aplica",
    "color": "color principal"
  },
  "alternatives": [
    { "name": "alternativa específica con variante", "confidence": 0 }
  ],
  "urgencyLevel": "SEGURO",
  "urgencyReason": "justificación breve del nivel de urgencia en máximo 80 caracteres",
  "chemicalWarning": "si el objeto puede contener compuestos químicos relevantes: lista los compuestos probables y su riesgo. Si no aplica: vacío"
}

REGLAS CRÍTICAS:
- description máximo 140 caracteres
- alternatives máximo 2 items
- urgencyLevel debe ser exactamente uno de: SEGURO, REVISAR, ATENCIÓN, PELIGRO
- SEGURO: objeto en buen estado sin riesgos detectables
- REVISAR: desgaste o condición que merece atención no urgente
- ATENCIÓN: daño significativo, riesgo potencial, requiere acción pronto
- PELIGRO: riesgo inmediato para la salud o seguridad (batería abultada, producto tóxico, estructura comprometida, sustancia peligrosa)
- chemicalWarning: úsalo para alimentos procesados, humo, polvo, gases, pinturas, solventes, productos de limpieza, medicamentos, materiales industriales
- Nunca respondas "No determinado" sin intentar inferir por similitud visual`;

// ─── LUNA: Genera specs y análisis profundo SIN imagen, solo con datos de Sol ──
const PROMPT_LUNA_SPECS = (
  objectType: string,
  brand: string,
  model: string,
  description: string,
  characteristics: Record<string, string>,
  urgencyLevel: string,
  urgencyReason: string,
  chemicalWarning: string
) => {
  const estadoFisico   = characteristics['estado_fisico']          || '';
  const entorno        = characteristics['entorno_visible']         || '';
  const implicaciones  = characteristics['implicaciones']           || '';
  const conexiones     = characteristics['conexiones_componentes']  || '';
  const textoVisible   = characteristics['texto_visible']           || '';

  return `Eres un analista experto en objetos físicos, materiales y seguridad. Recibes el resultado de un análisis visual forense ya realizado por otro sistema. Tu tarea es generar un análisis profundo, inteligente y accionable basado en esos datos reales.

DATOS DEL ANÁLISIS VISUAL:
- Objeto: ${objectType}
- Marca: ${brand}
- Modelo: ${model}
- Descripción detectada: ${description}
- Nivel de urgencia: ${urgencyLevel} — ${urgencyReason}
${estadoFisico   ? `- Estado físico: ${estadoFisico}`          : ''}
${entorno        ? `- Entorno visible: ${entorno}`              : ''}
${implicaciones  ? `- Implicaciones detectadas: ${implicaciones}` : ''}
${conexiones     ? `- Componentes visibles: ${conexiones}`      : ''}
${textoVisible   ? `- Texto visible: ${textoVisible}`           : ''}
${chemicalWarning ? `- Advertencia química detectada: ${chemicalWarning}` : ''}

Responde SOLO con este JSON sin markdown:
{
  "contextAnalysis": "análisis contextual inteligente: 2-3 oraciones explicando qué implica el estado del objeto, qué lo causó y qué se recomienda. Basado SOLO en los datos reales de arriba",
  "chemicalAnalysis": "si hay advertencia química: explica los compuestos probables, sus efectos en la salud y medidas de precaución específicas. Si no hay: cadena vacía",
  "riskAssessment": "evaluación de riesgo detallada si urgencyLevel es ATENCIÓN o PELIGRO. Explica el riesgo concreto y pasos a seguir. Si es SEGURO o REVISAR: cadena vacía",
  "recommendations": "2-3 recomendaciones concretas y accionables basadas en lo observado. Siempre presente"
}

REGLAS:
- Basa TODO en los datos reales, no inventes información
- Si hay riesgo químico, sé específico con los compuestos (ej: dióxido de nitrógeno, monóxido de carbono, partículas PM2.5, etc.)
- Si hay daño físico grave, da pasos concretos (ej: "no conectar hasta revisar el puerto", "reemplazar batería inmediatamente")
- Responde SOLO con el JSON`;
};

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

function safeParseJSON(raw: string): any {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      return JSON.parse(tryRepairJSON(cleaned));
    } catch (e2) {
      throw new Error(`JSON inválido: ${(e2 as Error).message}`);
    }
  }
}

// ─── FASE 0: Decidir nivel de detalle ─────────────────────────────────────────
async function decideDetailLevel(base64Image: string, apiKey: string): Promise<boolean> {
  try {
    const response = await axios.post(
      OPENAI_URL,
      {
        model: 'gpt-6-luna',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'low' },
              },
              { type: 'text', text: PROMPT_DETAIL_CHECK },
            ],
          },
        ],
        max_completion_tokens: 60,
      },
      {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    const parsed = safeParseJSON(response.data.choices[0].message.content || '{}');
    const needs = parsed.needsHighDetail === true;
    console.log(`🔍 Nivel de detalle: ${needs ? 'HIGH' : 'LOW'} — ${parsed.reason || ''}`);
    return needs;
  } catch (e) {
    console.log('⚠️ Detail check falló, usando high por defecto');
    return true;
  }
}

// ─── FASE 1: Sol analiza imagen ────────────────────────────────────────────────
async function analyzWithSol(
  base64Image: string,
  ocrText: string,
  needsHighDetail: boolean,
  apiKey: string
): Promise<GeminiResult> {
  const response = await axios.post(
    OPENAI_URL,
    {
      model: 'gpt-6-sol',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: needsHighDetail ? 'high' : 'low',
              },
            },
            { type: 'text', text: PROMPT_SOL(ocrText) },
          ],
        },
      ],
      max_completion_tokens: 1400,
    },
    {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 35000,
    }
  );

  const choice      = response.data.choices[0];
  const rawText     = choice.message.content || '';
  const finishReason = choice.finish_reason || '';

  console.log(`✅ Sol | finish: ${finishReason} | chars: ${rawText.length} | detail: ${needsHighDetail ? 'high' : 'low'}`);
  if (finishReason === 'length') console.log('⚠️ JSON cortado por max_tokens, reparando...');

  const parsed = safeParseJSON(rawText);

  return {
    objectType:      parsed.objectType      || 'Desconocido',
    brand:           parsed.brand           || 'Desconocida',
    model:           parsed.model           || 'No identificado',
    description:     parsed.description     || '',
    confidence:      parsed.confidence      || 0,
    characteristics: parsed.characteristics || {},
    alternatives:    parsed.alternatives    || [],
    urgencyLevel:    parsed.urgencyLevel    || 'SEGURO',
    urgencyReason:   parsed.urgencyReason   || '',
    chemicalWarning: parsed.chemicalWarning || '',
    rawAnalysis:     rawText,
  };
}

// ─── FASE 2: Luna genera specs y análisis profundo (sin imagen) ────────────────
async function generateLunaSpecs(
  solResult: GeminiResult,
  apiKey: string
): Promise<LunaSpecs> {
  const prompt = PROMPT_LUNA_SPECS(
    solResult.objectType,
    solResult.brand,
    solResult.model,
    solResult.description,
    solResult.characteristics,
    solResult.urgencyLevel,
    solResult.urgencyReason,
    solResult.chemicalWarning
  );

  try {
    const response = await axios.post(
      OPENAI_URL,
      {
        model: 'gpt-6-luna',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 500,
      },
      {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 20000,
      }
    );

    const rawText = response.data.choices[0].message.content || '';
    console.log('🧠 Luna specs generado');
    const parsed = safeParseJSON(rawText);

    return {
      contextAnalysis:  parsed.contextAnalysis  || '',
      chemicalAnalysis: parsed.chemicalAnalysis  || '',
      riskAssessment:   parsed.riskAssessment    || '',
      recommendations:  parsed.recommendations   || '',
    };
  } catch (e: any) {
    console.log('⚠️ Luna specs error:', e.message);
    return { contextAnalysis: '', chemicalAnalysis: '', riskAssessment: '', recommendations: '' };
  }
}

// ─── Exports principales ───────────────────────────────────────────────────────
export async function analyzeImageWithGemini(
  imagePath: string,
  ocrText: string
): Promise<GeminiResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada');

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  console.log('🤖 Iniciando análisis Sol+Luna');

  // Fase 0: decidir nivel de detalle (llamada barata)
  const needsHighDetail = await decideDetailLevel(base64Image, apiKey);

  // Fase 1: Sol analiza la imagen
  try {
    return await analyzWithSol(base64Image, ocrText, needsHighDetail, apiKey);
  } catch (error: any) {
    const message = error.response?.data?.error?.message || error.message;
    console.log(`⚠️ Sol error: ${message}`);
    throw new Error(`Error de IA: ${message}`);
  }
}

export async function analyzeContextWithGemini(
  solResult: GeminiResult
): Promise<LunaSpecs> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { contextAnalysis: '', chemicalAnalysis: '', riskAssessment: '', recommendations: '' };
  return generateLunaSpecs(solResult, apiKey);
}
