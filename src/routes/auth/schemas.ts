import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email inválido')
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128)
  .refine((s) => /[A-Za-z]/.test(s), 'Debe contener al menos una letra')
  .refine((s) => /\d/.test(s), 'Debe contener al menos un número');

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'La contraseña es obligatoria'),
});

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1).max(128),
  password: passwordSchema,
});

export const userPublicSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
});

export type UserPublic = z.infer<typeof userPublicSchema>;
