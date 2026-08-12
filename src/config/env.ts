import 'dotenv/config';
import Joi from 'joi';

const envSchema = Joi.object({
    HOST: Joi.string().default('localhost'),
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

    R2_ACCOUNT_ID: Joi.string().optional(),
    R2_ACCESS_KEY_ID: Joi.string().optional(),
    R2_SECRET_ACCESS_KEY: Joi.string().optional(),
    R2_BUCKET_NAME: Joi.string().optional(),
    R2_PUBLIC_DOMAIN: Joi.string().optional(),

    // BR-04 Time Box: jendela 12 jam harian tempat seluruh aktivitas pengerjaan
    // diizinkan. Format "HH:MM" waktu lokal acara. Kosongkan salah satunya untuk
    // menonaktifkan pembatasan (mis. saat uji coba di luar jam acara).
    EVENT_WINDOW_START: Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
    EVENT_WINDOW_END: Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
    // Offset zona waktu acara terhadap UTC, dalam jam. Yogyakarta = WIB = 7.
    EVENT_TIMEZONE_OFFSET: Joi.number().default(7),
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
    R2_ACCOUNT_ID?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
    R2_BUCKET_NAME?: string;
    R2_PUBLIC_DOMAIN?: string;
    EVENT_WINDOW_START?: string;
    EVENT_WINDOW_END?: string;
    EVENT_TIMEZONE_OFFSET: number;
};

export default env;