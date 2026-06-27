import type { Request, Response, NextFunction } from 'express';
import type Joi from 'joi';
import ApiError from '../utils/ApiError.ts';

interface ValidationSchema {
  body?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
}

const validate = (schema: ValidationSchema) => {
  return (req: Request, _res: Response, next: NextFunction) => {
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
