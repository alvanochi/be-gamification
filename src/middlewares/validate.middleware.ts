import type { Request, Response, NextFunction } from 'express';
import type Joi from 'joi';
import type { ZodTypeAny } from 'zod';
import ApiError from '../utils/ApiError.ts';

interface JoiValidationSchema {
  body?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
}

// Zod schemas in this codebase are shaped as z.object({ body, params?, query? })
// and passed directly (not wrapped), unlike the Joi convention below.
const isZodSchema = (schema: unknown): schema is ZodTypeAny =>
  !!schema && typeof (schema as { safeParse?: unknown }).safeParse === 'function';

const validate = (schema: JoiValidationSchema | ZodTypeAny) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (isZodSchema(schema)) {
      const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });

      if (!result.success) {
        const messages = result.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        );
        return next(new ApiError(messages.join('; '), 400));
      }

      const data = result.data as { body?: unknown; params?: unknown; query?: unknown };
      if (data.body !== undefined) req.body = data.body;
      return next();
    }

    const errors: string[] = [];

    if (schema.body) {
      const { error, value } = schema.body.validate(req.body, { abortEarly: false, stripUnknown: true });
      if (error) {
        errors.push(
          ...error.details.map((e) => e.message),
        );
      } else {
        req.body = value;
      }
    }

    if (schema.params) {
      const { error } = schema.params.validate(req.params, { abortEarly: false, allowUnknown: true });
      if (error) {
        errors.push(
          ...error.details.map((e) => e.message),
        );
      }
    }

    if (schema.query) {
      const { error } = schema.query.validate(req.query, { abortEarly: false, allowUnknown: true });
      if (error) {
        errors.push(
          ...error.details.map((e) => e.message),
        );
      }
    }

    if (errors.length > 0) {
      return next(new ApiError(errors.join('; '), 400));
    }

    next();
  };
};

export default validate;
