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
};

export default env;