import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

/** Giao diện Swagger UI. File JSON nằm ở `${OPENAPI_PATH}-json`. */
export const OPENAPI_PATH = 'api/docs';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Kiot API')
    .setDescription(
      'API hệ thống quản lý bán hàng sỉ. Quy ước chung (tiền là chuỗi thập phân, lỗi, phân trang, idempotency): ' +
        'xem docs/api/README.md.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Gắn Swagger UI tại `/api/docs` và JSON tại `/api/docs-json` (không nằm dưới `/api/v1`). */
export function setupOpenApi(app: INestApplication): void {
  // Dạng factory: tài liệu chỉ được dựng khi có người truy cập lần đầu.
  SwaggerModule.setup(OPENAPI_PATH, app, () => createOpenApiDocument(app), {
    customSiteTitle: 'Kiot API',
    swaggerOptions: { persistAuthorization: true },
  });
}
