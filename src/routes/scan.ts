import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeImageWithGemini, analyzeContextWithGemini, GeminiResult } from '../services/aiService';
import { searchWikipedia } from '../services/wikipediaService';
import { calculateConfidence } from '../services/confidenceEngine';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  let tempImagePath: string | null = null;

  try {
    const { imageBase64, ocrText = '' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'No se recibió imagen' });
    }

    tempImagePath = path.join('uploads', `scan_${Date.now()}.jpg`);
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    fs.writeFileSync(tempImagePath, imageBuffer);

    const ocrCount = ocrText.split(' ').filter((w: string) => w.length > 1).length;
    console.log('📸 Imagen recibida:', imageBuffer.length, 'bytes');

    // FASE 1: Sol analiza la imagen visualmente
    const solResult: GeminiResult = await analyzeImageWithGemini(tempImagePath, ocrText);
    console.log('✅ Sol:', solResult.brand, solResult.model, `${solResult.confidence}% | ${solResult.urgencyLevel}`);

    // FASE 2: Luna + Wikipedia en paralelo (Luna sin imagen = muy barato)
    const searchQuery = `${solResult.brand} ${solResult.model}`.trim();

    const [wikiResult, lunaSpecs] = await Promise.all([
      searchWikipedia(searchQuery),
      analyzeContextWithGemini(solResult),
    ]);

    console.log('📖 Wikipedia:', wikiResult.found ? wikiResult.title : 'No encontrado');
    console.log('🧠 Luna specs: OK');

    // FASE 3: Confianza final
    const confidence = calculateConfidence(solResult, wikiResult, ocrCount);
    console.log('📊 Confianza:', confidence.score + '%', '-', confidence.level);

    res.json({
      success: true,
      result: {
        objectType:  solResult.objectType,
        brand:       solResult.brand,
        model:       solResult.model,
        description: solResult.description,
        confidence: {
          score:         confidence.score,
          level:         confidence.level,
          color:         confidence.color,
          message:       confidence.message,
          needsMoreInfo: confidence.needsMoreInfo,
          suggestions:   confidence.suggestions,
        },
        urgency: {
          level:  solResult.urgencyLevel,
          reason: solResult.urgencyReason,
          color:  urgencyColor(solResult.urgencyLevel),
        },
        characteristics:  solResult.characteristics,
        alternatives:     solResult.alternatives,
        chemicalWarning:  solResult.chemicalWarning || '',
        additionalInfo: {
          contextAnalysis:  lunaSpecs.contextAnalysis,
          chemicalAnalysis: lunaSpecs.chemicalAnalysis,
          riskAssessment:   lunaSpecs.riskAssessment,
          recommendations:  lunaSpecs.recommendations,
          wikipedia: {
            found:   wikiResult.found,
            title:   wikiResult.title,
            summary: wikiResult.summary,
            url:     wikiResult.url,
          },
        },
        sources: [
          { name: 'OpenAI Sol — Análisis forense visual', type: 'Visión artificial de alta precisión', url: 'https://openai.com' },
          { name: 'OpenAI Luna — Análisis e inferencia',  type: 'Razonamiento y especificaciones',     url: 'https://openai.com' },
          ...(wikiResult.found ? [{ name: wikiResult.title, type: 'Base de conocimiento', url: wikiResult.url }] : []),
        ],
      },
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, error: error.message || 'Error interno' });
  } finally {
    if (tempImagePath && fs.existsSync(tempImagePath)) {
      fs.unlinkSync(tempImagePath);
    }
  }
});

function urgencyColor(level: string): string {
  switch (level) {
    case 'PELIGRO':  return '#ff0000';
    case 'ATENCIÓN': return '#ff8c00';
    case 'REVISAR':  return '#ffcc00';
    default:         return '#00ff88';
  }
}

export default router;
