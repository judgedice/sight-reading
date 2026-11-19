// Types for the generated src/store/export-file-validator.js (tools/generate-validators.ts).
import type { ErrorObject } from 'ajv';

export interface ExportFileValidator {
  (data: unknown): boolean;
  /** Set by each call: null when the data is valid, else the errors Ajv found (only the first with allErrors off). */
  errors?: ErrorObject[] | null;
}

export declare const validate: ExportFileValidator;
export default validate;
