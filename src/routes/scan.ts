import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeImageWithGemini, analyzeContextWithGemini } from '../services/geminiService';
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

    // Guardar imagen base64 como archivo temporal
    tempImagePath = path.join('uploads', `scan_${Date.now()}.jpg`);
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    fs.writeFileSync(tempImagePath, imageBuffer);

    const ocrCount = ocrText.split(' ').filter((w: string) => w.length > 1).length;

    console.log('📸 Imagen recibida, tamaño:', imageBuffer.length, 'bytes');
    console.log('📝 Texto OCR:', ocrText || '(ninguno)');

    // FASE 1: Análisis con Gemini Vision
    console.log('🤖 Analizando con Gemini...');
    const geminiResult = await analyzeImageWithGemini(tempImagePath, ocrText);
    console.log('✅ Gemini:', geminiResult.brand, geminiResult.model, `${geminiResult.confidence}%`);

    // FASE 2: Información adicional y análisis contextual en paralelo
    console.log('🔍 Buscando información adicional...');
    console.log('🧠 Generando análisis contextual...');

    const searchQuery = `${geminiResult.brand} ${geminiResult.model}`.trim();

    const [wikiResult, contextAnalysis] = await Promise.all([
      searchWikipedia(searchQuery),
      analyzeContextWithGemini(
        geminiResult.objectType,
        geminiResult.brand,
        geminiResult.model,
        geminiResult.description,
        geminiResult.characteristics
      ),
    ]);

    console.log('📖 Info adicional:', wikiResult.found ? wikiResult.title : 'No encontrado');
    console.log('🧠 Análisis contextual:', contextAnalysis ? 'Generado' : 'No generado');

    // FASE 3: Calcular confianza
    const confidence = calculateConfidence(geminiResult, wikiResult, ocrCount);
    console.log('📊 Confianza final:', confidence.score + '%', '-', confidence.level);

    const response = {
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
            name: 'Gemini Vision AI',
            type: 'Análisis visual por IA',
            url:  'https://ai.google.dev',
          },
          {
            name: 'Gemini AI — Análisis contextual',
            type: 'Razonamiento e inferencia por IA',
            url:  'https://ai.google.dev',
          },
          ...(wikiResult.found ? [{
            name: wikiResult.title,
            type: 'Base de conocimiento',
            url:  wikiResult.url,
          }] : []),
        ],
      },
    };

    res.json(response);

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