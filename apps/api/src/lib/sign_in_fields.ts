import { z } from 'zod';

export const email_schema = z.string().trim().toLowerCase().email().max(254);
export const new_password_schema = z.string().min(10).max(200);
export const password_schema = z.string().min(1).max(200);
export const recovery_code_schema = z.string().trim().min(20).max(60);
