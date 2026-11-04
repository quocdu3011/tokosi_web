// Nạp .env (không ghi đè biến môi trường đã có, nên production dùng biến môi trường thật)
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`API:     http://localhost:${port}/api/v1`);
  console.log(`Swagger: http://localhost:${port}/api/docs`);
}
await bootstrap();
