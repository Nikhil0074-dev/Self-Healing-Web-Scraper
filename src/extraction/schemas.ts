import { z } from "zod";
import type { FieldSpec, ScrapeConfig } from "../types.js";

/** The example schema from the project brief: name, price, availability, url. */
export const ProductSchema = z.object({
  name: z.string().trim().min(1),
  price: z.number().nonnegative(),
  availability: z.enum(["In stock", "Out of stock", "Unknown"]),
  url: z.string().url(),
});

export type Product = z.infer<typeof ProductSchema>;

export const productFields: FieldSpec[] = [
  {
    name: "name",
    kind: "text",
    required: true,
    hints: ["product-title", "producttitle", "product-name", "item-title"],
    labels: ["product name", "title"],
    jsonld: ["name"],
    meta: ["og:title", "twitter:title"],
    seedSelector: "h1",
    description: "The product's title, usually the large heading near the top of the page.",
  },
  {
    name: "price",
    kind: "price",
    required: true,
    hints: ["price", "product-price", "current-price", "sale-price", "offer-price"],
    labels: ["price"],
    jsonld: ["offers.price", "offers.priceSpecification.price"],
    meta: ["product:price:amount", "og:price:amount"],
    description: "The current selling price shown to the buyer (not a struck-through original price).",
  },
  {
    name: "availability",
    kind: "availability",
    required: true,
    hints: ["availability", "stock-status", "in-stock", "out-of-stock"],
    labels: ["availability"],
    jsonld: ["offers.availability"],
    description: "Whether the item is in stock, out of stock, or unknown.",
    defaultValue: "Unknown",
  },
  {
    name: "url",
    kind: "url",
    required: true,
    hints: [],
    jsonld: ["url", "offers.url"],
    meta: ["canonical", "og:url"],
    description: "The canonical product page URL.",
  },
];

/** Builds a Zod object schema from field specs when the caller (e.g. the HTTP API) supplies fields at runtime. */
export function buildZodSchema(fields: FieldSpec[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    let type: z.ZodTypeAny;
    switch (field.kind) {
      case "price":
        type = z.number().nonnegative();
        break;
      case "availability":
        type = z.enum(["In stock", "Out of stock", "Unknown"]);
        break;
      case "url":
        type = z.string().url();
        break;
      case "text":
        type = z.string().trim().min(1);
        break;
    }
    shape[field.name] = field.required ? type : type.optional();
  }
  return z.object(shape);
}

export const productScrapeConfig: ScrapeConfig = {
  name: "product",
  fields: productFields,
  schema: ProductSchema,
  jsonldTypes: ["Product"],
};
