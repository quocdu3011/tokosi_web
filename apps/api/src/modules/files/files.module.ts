import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import {
  FileStorage,
  S3FileStorage,
  UnconfiguredFileStorage,
} from './file-storage.js';

/** Kho file ảnh (S3/MinIO). Module nào cần thì import; Nest chỉ tạo một bản dùng chung. */
@Module({
  providers: [
    {
      provide: FileStorage,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): FileStorage =>
        config.storage
          ? new S3FileStorage(config.storage)
          : new UnconfiguredFileStorage(),
    },
  ],
  exports: [FileStorage],
})
export class FilesModule {}
