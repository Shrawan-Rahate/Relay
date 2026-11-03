import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const shadowUrl = process.env.SHADOW_DATABASE_URL;

if (shadowUrl && process.env.DATABASE_URL && shadowUrl === process.env.DATABASE_URL) {
  throw new Error("SHADOW_DATABASE_URL must not match DATABASE_URL");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ? env("DATABASE_URL") : "postgresql://placeholder:placeholder@localhost:5432/placeholder",
    ...(shadowUrl ? { shadowDatabaseUrl: env("SHADOW_DATABASE_URL") } : {}),
  },
});
