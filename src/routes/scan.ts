import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeImageWithGemini, analyzeContextWithGemini } from '../services/aiService';
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

    // Guardar imagen temporal
    tempImagePath = path.join('uploads', `scan_${Date.now()}.jpg`);
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    fs.writeFileSync(tempImagePath, imageBuffer);

    const ocrCount = ocrText.split(' ').filter((w: string) => w.length > 1).length;
    const scanMode = (req.body.scanMode as 'standard' | 'advanced') || 'standard';

    console.log('📸 Imagen recibida:', imageBuffer.length, 'bytes | modo:', scanMode);

    // FASE 1: Análisis visual principal
    const geminiResult = await analyzeImageWithGemini(tempImagePath, ocrText, scanMode);
    console.log('✅ Visual:', geminiResult.brand, geminiResult.model, `${geminiResult.confidence}%`);

    // FASE 2: Wikipedia + análisis contextual en paralelo
    // El análisis contextual ahora recibe las características completas
    // para razonar sobre lo que el modelo visual YA detectó
    const searchQuery = `${geminiResult.brand} ${geminiResult.model}`.trim();

    const [wikiResult, contextAnalysis] = await Promise.all([
      searchWikipedia(searchQuery),
      analyzeContextWithGemini(
        geminiResult.objectType,
        geminiResult.brand,
        geminiResult.model,
        geminiResult.description,
        geminiResult.characteristics   // ← pasa todas las características detectadas
      ),
    ]);

    console.log('📖 Wikipedia:', wikiResult.found ? wikiResult.title : 'No encontrado');
    console.log('🧠 Contextual:', contextAnalysis ? 'OK' : 'Vacío');

    // FASE 3: Calcular confianza final
    const confidence = calculateConfidence(geminiResult, wikiResult, ocrCount);
    console.log('📊 Confianza:', confidence.score + '%', '-', confidence.level);

    res.json({
      success: true,
      result: {
        objectType:  geminiResult.objectType,
        brand:       geminiResult.brand,
        model:       geminiResult.model,
        description: geminiResult.description,
        confidence: {
          score:         confidence.score,
          level:         confidence.level,
          color:         confidence.color,
          message:       confidence.message,
          needsMoreInfo: confidence.needsMoreInfo,
          suggestions:   confidence.suggestions,
        },
        characteristics: geminiResult.characteristics,
        alternatives:    geminiResult.alternatives,
        additionalInfo: {
          contextAnalysis: contextAnalysis || '',
          wikipedia: {
            found:   wikiResult.found,
            title:   wikiResult.title,
            summary: wikiResult.summary,
            url:     wikiResult.url,
          },
        },
        sources: [
          {
            name: 'OpenAI Vision',
            type: 'Análisis visual por IA',
            url:  'https://openai.com',
          },
          {
            name: 'OpenAI — Análisis contextual',
            type: 'Razonamiento e inferencia por IA',
            url:  'https://openai.com',
          },
          ...(wikiResult.found ? [{
            name: wikiResult.title,
            type: 'Base de conocimiento',
            url:  wikiResult.url,
          }] : []),
        ],
      },
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Error interno',
    });
  } finally {
    if (tempImagePath && fs.existsSync(tempImagePath)) {
      fs.unlinkSync(tempImagePath);
    }
  }
});

export default router;