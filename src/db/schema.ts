import { bigint, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { LineString, MultiPolygon } from "geojson";

export const segmentStatus = pgEnum("segment_status", ["red", "yellow", "green"]);
export type SegmentStatus = (typeof segmentStatus.enumValues)[number];

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  // sha256 of the cookie token, so a database leak does not leak live sessions
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const barrios = pgTable("barrios", {
  id: serial("id").primaryKey(),
  osmId: bigint("osm_id", { mode: "number" }).notNull().unique(),
  name: text("name").notNull(),
  geometry: jsonb("geometry").$type<MultiPolygon>().notNull(),
});

export const segments = pgTable(
  "segments",
  {
    id: serial("id").primaryKey(),
    // `<way id>:<first node id>:<last node id>`, stable across re-imports while OSM keeps the way
    key: text("key").notNull().unique(),
    streetName: text("street_name").notNull(),
    barrioId: integer("barrio_id")
      .notNull()
      .references(() => barrios.id),
    geometry: jsonb("geometry").$type<LineString>().notNull(),
    status: segmentStatus("status").notNull().default("red"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("segments_barrio_idx").on(t.barrioId)],
);

export const statusChanges = pgTable("status_changes", {
  id: serial("id").primaryKey(),
  segmentId: integer("segment_id")
    .notNull()
    .references(() => segments.id, { onDelete: "cascade" }),
  from: segmentStatus("from").notNull(),
  to: segmentStatus("to").notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
