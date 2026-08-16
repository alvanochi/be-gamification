import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';

/**
 * Kategori kelompok — mis. "Putra", "Putri", "Campuran", atau pembagian tim
 * lain sesuai kebutuhan panitia.
 *
 * Warna disimpan bersama kategorinya supaya penandaan di seluruh layar
 * konsisten, dan panitia bisa menentukan sendiri warna yang mudah dibedakan.
 */
export const groupCategories = pgTable('group_categories', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  /** Warna heksadesimal, mis. "#E8543F". */
  color: varchar('color', { length: 9 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
});
