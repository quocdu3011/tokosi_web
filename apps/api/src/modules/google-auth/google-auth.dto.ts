import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({
    description:
      'Access token (JWT) Supabase nhận được sau khi đăng nhập Google (`session.access_token`)',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(8192)
  accessToken!: string;
}

export class GoogleSignupRequiredDto {
  @ApiProperty({ example: 'signup_required' }) status!: 'signup_required';
  @ApiProperty({
    description:
      'Token ngắn hạn (15 phút) chỉ dùng cho `POST /auth/google/signup`; không phải access token',
  })
  signupToken!: string;
  @ApiProperty({ example: 'an@congty.vn' }) email!: string;
  @ApiProperty({ nullable: true, description: 'Tên lấy từ Google để điền sẵn' })
  suggestedName!: string | null;
}

export class GoogleSignupDto {
  @ApiProperty({ description: '`signupToken` nhận từ `POST /auth/google`' })
  @IsString()
  @MaxLength(4096)
  signupToken!: string;

  @ApiProperty({
    example: 'nguyenvana',
    description: 'Chữ thường không dấu, số, `.` `_` `-`; 3–32 ký tự',
  })
  @IsString()
  @MaxLength(64)
  username!: string;

  @ApiProperty({
    description: '10–128 ký tự, không chứa tên đăng nhập',
  })
  @IsString()
  @MaxLength(256)
  password!: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ example: '0901234567' })
  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class AuthSettingsDto {
  @ApiProperty({ description: 'Cho phép người lạ tự đăng ký bằng Google' })
  googleSignupEnabled!: boolean;
  @ApiProperty({
    type: [String],
    example: ['congty.vn'],
    description:
      'Tên miền email được tự đăng ký; bật mà để rỗng là không hợp lệ',
  })
  googleSignupDomains!: string[];
}

export class UpdateAuthSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  googleSignupEnabled?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  googleSignupDomains?: string[];
}
