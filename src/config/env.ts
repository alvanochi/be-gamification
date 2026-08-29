import 'dotenv/config';
import Joi from 'joi';

const envSchema = Joi.object({
    HOST: Joi.string().default('0.0.0.0'),
    PORT: Joi.number().default(3000),
    NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

    PGHOST: Joi.string().required(),
    PGPORT: Joi.number().default(5432),
    PGDATABASE: Joi.string().required(),
    PGUSER: Joi.string().required(),
    PGPASSWORD: Joi.string().required(),

    ACCESS_TOKEN_KEY: Joi.string().required(),
    REFRESH_TOKEN_KEY: Joi.string().required(),
    ACCESS_TOKEN_AGE: Joi.number().default(180),
    REFRESH_TOKEN_AGE: Joi.number().default(10080),

    // Awalan URL media bila API dilayani lewat domain lain (mis. di balik
    // reverse proxy). Kosong berarti disusun dari permintaan yang masuk.
    MEDIA_BASE_URL: Joi.string().optional(),

    // BR-04 Time Box: jendela 12 jam harian tempat seluruh aktivitas pengerjaan
    // diizinkan. Format "HH:MM" waktu lokal acara. Kosongkan salah satunya untuk
    // menonaktifkan pembatasan (mis. saat uji coba di luar jam acara).
    EVENT_WINDOW_START: Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
    EVENT_WINDOW_END: Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
    // Offset zona waktu acara terhadap UTC, dalam jam. Yogyakarta = WIB = 7.
    EVENT_TIMEZONE_OFFSET: Joi.number().default(7),

    // Kunci bersama untuk pihak eksternal yang mengirim data media sosial.
    // Sengaja tidak wajib: server tetap menyala tanpa itu, hanya jalur
    // /api/external yang menolak seluruh permintaan sampai kuncinya dipasang.
    EXTERNAL_API_KEY: Joi.string().min(16).optional(),
}).unknown(true);

const { error, value } = envSchema.validate(process.env);

if (error) {
    console.error(' Invalid environment variables:');
    console.error(error.details.map((d) => d.message).join('\n'));
    process.exit(1);
}

const env = value as {
    HOST: string;
    PORT: number;
    NODE_ENV: 'development' | 'production' | 'test';
    PGHOST: string;
    PGPORT: number;
    PGDATABASE: string;
    PGUSER: string;
    PGPASSWORD: string;
    ACCESS_TOKEN_KEY: string;
    REFRESH_TOKEN_KEY: string;
    ACCESS_TOKEN_AGE: number;
    REFRESH_TOKEN_AGE: number;
    MEDIA_BASE_URL?: string;
    EVENT_WINDOW_START?: string;
    EVENT_WINDOW_END?: string;
    EVENT_TIMEZONE_OFFSET: number;
    EXTERNAL_API_KEY?: string;
};

export default env;