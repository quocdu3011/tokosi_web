// Nạp .env (không ghi đè biến môi trường đã có, nên production dùng biến môi trường thật)
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import ip from 'ip';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3001;

  await app.listen(port, '0.0.0.0');
  const localIp = ip.address();
  console.log(`Local API:   http://localhost:${port}/api/v1`);
  console.log(`LAN API:     http://${localIp}:${port}/api/v1`);
  console.log(`LAN Swagger: http://${localIp}:${port}/api/docs`);
}
await bootstrap();
