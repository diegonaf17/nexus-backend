import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import * as fs from 'fs';
import scanRouter from './routes/scan';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

// Crear carpeta de uploads si no existe
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rutas
app.use('/api/scan', scanRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'NEXUS Backend',
    timestamp: new Date().toISOString(),
  });
});

// Manejador de errores global — evita que el servidor muera
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Error no manejado en Express:', err.message);
  res.status(500).json({
    success: false,
    error: err.message || 'Error interno del servidor',
  });
});

// Capturar errores async no capturados — evita crash del proceso
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err.message);
  // No cerramos el proceso — el servidor sigue corriendo
});

process.on('unhandledRejection', (reason: any) => {
  console.error('❌ unhandledRejection:', reason?.message || reason);
  // No cerramos el proceso — el servidor sigue corriendo
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════╗');
  console.log('║      NEXUS BACKEND  v1.0         ║');
  console.log('║      Puerto: ' + PORT + '                  ║');
  console.log('║      Estado: ONLINE              ║');
  console.log('╚══════════════════════════════════╝');
  console.log('');
});